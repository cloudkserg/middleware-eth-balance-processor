/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

require('dotenv/config');

const config = require('../config'),
  mongoose = require('mongoose'),
  Promise = require('bluebird');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});

const  net = require('net'),
  Web3 = require('web3'),
  web3 = new Web3(),
  expect = require('chai').expect,
  WebSocket = require('ws'),
  amqp = require('amqplib'),
  Stomp = require('webstomp-client'),
  ctx = {},
  _ = require('lodash'),
  BigNumber = require('bignumber.js'),
  contract = require('truffle-contract'),  
  erc20token = require('../build/contracts/TokenContract.json'),
  smEvents = require('../controllers/eventsCtrl')(erc20token),  
  erc20contract = contract(erc20token),
  getBalanceForTCAddress = require('./helpers/getBalanceforTCAddress'),
  getBalanceForAccount= require('./helpers/getBalanceForAccount'),
  clearQueues = require('./helpers/clearQueues'),
  updateBalanceWithEth = require('./helpers/updateBalanceWithEth'),
  updateTcBalanceWithEth = require('./helpers/updateTcBalanceWithEth'),
  connectToQueue = require('./helpers/connectToQueue'),
  clearMongoData = require('./helpers/clearMongoData'),
  saveAccounts = require('./helpers/saveAccounts'),
  consumeMessages = require('./helpers/consumeMessages');

let TC, accounts, amqpInstance;

describe('core/sc processor', function () {

  before(async () => {
    await clearMongoData();
    amqpInstance = await amqp.connect(config.rabbit.url);

    let provider = new Web3.providers.IpcProvider(config.web3.uri, net);
    web3.setProvider(provider);
    erc20contract.setProvider(provider);

    accounts = await Promise.promisify(web3.eth.getAccounts)();
    TC = await erc20contract.new({from: accounts[0], gas: 1000000});

    await saveAccounts(accounts, TC.address);
  });

  after(async () => {
    web3.currentProvider.connection.end();
    return mongoose.disconnect();
  });

  afterEach(async () => {
    return await clearQueues(amqpInstance);  
  });

  it('send some eth and validate balance changes', async () => {
    await Promise.all([
      (async () => {
        const oldBalance0 = await updateBalanceWithEth(accounts[0], web3);      
        const oldBalance1 = await updateBalanceWithEth(accounts[1], web3);       

        ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
          from: accounts[0],
          to: accounts[1],
          value: 100
        });
    
        await Promise.delay(10000);
        const newBalance0 = await getBalanceForAccount(accounts[0]);
        const newBalance1 = await getBalanceForAccount(accounts[1]);
        expect(oldBalance0.minus(newBalance0).toNumber()).to.greaterThan(0);
        expect(newBalance1.minus(oldBalance1).toNumber()).to.greaterThan(0);
      })(),
      (async () => {

        let amqpInstance = await amqp.connect(config.rabbit.url);
        let channel = await amqpInstance.createChannel();
        try {
          await channel.assertExchange('events', 'topic', {durable: false});
          await channel.assertQueue(`app_${config.rabbit.serviceName}_test.balance`);
          await channel.bindQueue(`app_${config.rabbit.serviceName}_test.balance`, 'events', `${config.rabbit.serviceName}_balance.*`);
        } catch (e) {
          channel = await amqpInstance.createChannel();
        }

        return await new Promise(res =>
          channel.consume(`app_${config.rabbit.serviceName}_test.balance`, res, {noAck: true})
        );

      })(),
      (async () => {
        let ws = new WebSocket('ws://localhost:15674/ws');
        let client = Stomp.over(ws, {heartbeat: false, debug: false});
        return await new Promise(res =>
          client.connect('guest', 'guest', () => {
            client.subscribe(`/exchange/events/${config.rabbit.serviceName}_balance.*`, res);
          })
        );
      })()
    ]);

  });

  it('common: check Module /controllers/eventsCtrl', async () => {
    expect(smEvents).to.have.property('eventModels');
    expect(smEvents).to.have.property('signatures');
    const events = _.chain(smEvents.signatures)
      .keys()
      .map(key => smEvents.signatures[key].name)
      .value();
    expect(events).to.include.members(['Transfer', 'Approval']);
  });

  //TRANSERS
  it('transfer: should transfer 100000 for accounts[0 => 1] and check balances, records in DB and amqp data', async () => {
    const oldBalance0 = await updateTcBalanceWithEth(accounts[0], TC);      
    const oldBalance1 = await updateTcBalanceWithEth(accounts[1], TC); 
    let transfer;
    return await Promise.all([
      (async () => {
        transfer = await TC.transfer(accounts[1], 100000, {from: accounts[0]});
      })(),
      (async () => {
        const channel = await amqpInstance.createChannel();  
        await connectToQueue(channel);
        return await consumeMessages(1, channel, async (message) => {
          const content = JSON.parse(message.content);
          if (_.has(content, 'erc20token') && content.tx.transactionHash  === transfer.tx) {
            expect(content.address).oneOf([accounts[0], accounts[1]]);
            expect(content.erc20token).to.equal(TC.address);
  
            if (content.address === accounts[0]) 
              expect(oldBalance0.minus(new BigNumber(content.balance)).toNumber()).to.greaterThan(0);
            else 
              expect(new BigNumber(content.balance).minus(oldBalance1).toNumber()).to.equal(100000);
            
            const newBalance0 = await getBalanceForTCAddress(accounts[0], TC);
            const newBalance1 = await getBalanceForTCAddress(accounts[1], TC);
            expect(oldBalance0.minus(newBalance0).toNumber()).to.greaterThan(0);
            expect(newBalance1.minus(oldBalance1).toNumber()).to.greaterThan(0);

            return true;
          } else 
            return false;
        });
      })()
    ]);
  });


  it('transfer: should transfer 1000 for accounts [2 => 3] and check not message in amqp', async () => {
    await TC.transfer(accounts[3], 100000, {from: accounts[2]});
    await Promise.delay(20000);

    const channel = await amqpInstance.createChannel();  
    const queue = await connectToQueue(channel);
    expect(queue.messageCount).to.equal(0);
  });

});
