/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

/**
 * Middleware service for handling user balance.
 * Update balances for accounts, which addresses were specified
 * in received transactions from blockParser via amqp
 *
 * @module Chronobank/eth-balance-processor
 * @requires config
 * @requires models/accountModel
 */

const config = require('./config'),
  mongoose = require('mongoose'),
  Promise = require('bluebird');

mongoose.Promise = Promise;
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri, {useMongoClient: true});

const accountModel = require('./models/accountModel'),
  Web3 = require('web3'),
  net = require('net'),
  _ = require('lodash'),
  bunyan = require('bunyan'),
  contract = require('truffle-contract'),
  log = bunyan.createLogger({name: 'core.balanceProcessor'}),
  amqp = require('amqplib'),
  erc20token = require('./build/contracts/TokenContract.json'),
  smEvents = require('./controllers/eventsCtrl')(erc20token),
  filterTxsBySMEventsService = require('./services/filterTxsBySMEventsService');

[mongoose.accounts, mongoose.connection].forEach(connection =>
  connection.on('disconnected', function () {
    log.error('mongo disconnected!');
    process.exit(0);
  })
);

const provider = new Web3.providers.IpcProvider(config.web3.uri, net);
const web3 = new Web3();
web3.setProvider(provider);


const Erc20Contract = contract(erc20token);
Erc20Contract.setProvider(provider);

const getAllAddresses = async (tx, recieptTx) => {
  const addresses = getAddressesFromReciept(recieptTx);
  const txAddresses = _.filter(
    getAddressesFromTx(tx),
    txAddr => _.find(addresses, addr => (addr.address === txAddr.address)) === undefined
  );
  return await filterAddresses(_.concat(addresses, txAddresses));
};

const getAddressesFromTx = (tx) => {
  if (!tx) 
    return [];
  return _.chain(tx).pick('to', 'from').map(address => ({address})).value();
};

const getAddressesFromReciept = (recieptTx) => {
  if (!recieptTx) 
    return [];
  const groupAdresses = _.chain(filterTxsBySMEventsService(recieptTx, web3, smEvents))
    .toPairs()
    .map(value => {
      const event  = value[1].payload;
      const erc20 = recieptTx.logs[value[0]].address;
      return _.chain(event).pick('from', 'to', 'owner', 'sender').uniq().map(address => ({
        address, erc20
      })).value();
    })
    .flattenDeep()
    .groupBy(address => address.address);
  
  return groupAdresses
    .toPairs()
    .map(value => _.merge({address: value[0]}, value[1]))
    .value();
};


const filterAddresses = async (addrObjs) => {
  if (addrObjs.length === 0) 
    return [];
  const addresses = _.map(addrObjs, 'address');
  const savedAddresses = _.map(await accountModel.find({address: {$in: addresses}}), 'address');
  return _.filter(addrObjs, addrObj => _.includes(savedAddresses, addrObj.address));
};

const getBalance = async (address) => {
  return await Promise.promisify(web3.eth.getBalance)(address);
};

const getErc20Balance = async (erc20Addr, address) => {
  const instance = await Erc20Contract.at(erc20Addr);
  return (await instance.balanceOf(address)).toNumber();
};




const buildUpdates = async (filteredAddresses, tx, recieptTx) => {
  return await Promise.map(filteredAddresses, 
    async addrObj => buildUpdate(addrObj, tx, recieptTx)
  );
};

const buildUpdate = async (addrObj) => {
  const update =  _.chain(addrObj)
    .merge({balance: await getBalance(addrObj.address)})
    .value();
  if (addrObj.erc20) 
    update['erc20token'] = await Promise.map(addrObj.erc20, async erc20Addr => ({
      [erc20Addr]: await getErc20Balance(erc20Addr, addrObj.address)
    })); 
  return update;
};

const updateBalancesAndGetModels  = async (updates) => {
  return await Promise.mapSeries(updates, async update => {
    const fields = {balance: update.balance};
    if (update['erc20']) 
      fields['erc20token'] = update['erc20']; 
    

    return await accountModel.findOneAndUpdate({address: update.address}, {$set: fields}, {new: true});
  });
};

const buildMessages = (models, tx, recieptTx) => {
  return _.map(models, model => ({
    address: model.address,
    tx,
    recieptTx,
    balance: model.balance,
    erc20token: _.get(model, 'erc20token', {})
  }));
};

let init = async () => {
  let conn = await amqp.connect(config.rabbit.url)
    .catch(() => {
      log.error('rabbitmq is not available!');
      process.exit(0);
    });

  let channel = await conn.createChannel();

  channel.on('close', () => {
    log.error('rabbitmq process has finished!');
    process.exit(0);
  });


  web3.currentProvider.connection.on('end', () => {
    log.error('ipc process has finished!');
    process.exit(0);
  });

  web3.currentProvider.connection.on('error', () => {
    log.error('ipc process has finished!');
    process.exit(0);
  });


  await channel.assertExchange('events', 'topic', {durable: false});
  await channel.assertQueue(`app_${config.rabbit.serviceName}.balance_processor`);
  await channel.bindQueue(`app_${config.rabbit.serviceName}.balance_processor`, 'events', `${config.rabbit.serviceName}_transaction.*`);

  channel.prefetch(2);

  channel.consume(`app_${config.rabbit.serviceName}.balance_processor`, async (data) => {
    try {
      let block = JSON.parse(data.content.toString());
      const tx = await Promise.promisify(web3.eth.getTransaction)(block.hash || '').timeout(10000);
      const recieptTx = await Promise.promisify(web3.eth.getTransactionReceipt)(block.hash || '').timeout(10000);

      const filteredAddresses = await getAllAddresses(tx, recieptTx);
      console.log('VVV', filteredAddresses);
      const updates = await buildUpdates(filteredAddresses);
      console.log('UUU', updates);
      
      const models = await updateBalancesAndGetModels(updates);
      const messages = buildMessages(models, tx, recieptTx);
      console.log('MMMM', messages);
      await Promise.map(messages, async message => {
        await  channel.publish('events', `${config.rabbit.serviceName}_balance.${message.address}`, new Buffer(JSON.stringify(message)));
      });

    } catch (e) {
      log.error(e);
    }
    channel.ack(data);    

  });
};

module.exports = init();
