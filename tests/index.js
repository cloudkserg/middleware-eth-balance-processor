require('dotenv/config');

const config = require('../config'),
  mongoose = require('mongoose'),
  Promise = require('bluebird');

mongoose.Promise = Promise;
mongoose.accounts = mongoose.createConnection(config.mongo.accounts.uri);
mongoose.connect(config.mongo.data.uri, {useMongoClient: true});

const awaitLastBlock = require('./helpers/awaitLastBlock'),
  clearMongoBlocks = require('./helpers/clearMongoBlocks'),
  saveAccountForAddress = require('./helpers/saveAccountForAddress'),
  syncBalanceForAddress = require('./helpers/syncBalanceForAddress'),
  getBalanceForAddress = require('./helpers/getBalanceForAddress'),
  connectToQueue = require('./helpers/connectToQueue'),
  clearQueues = require('./helpers/clearQueues'),
  net = require('net'),
  path = require('path'),
  Web3 = require('web3'),
  web3 = new Web3(),
  expect = require('chai').expect,
  WebSocket = require('ws'),
  accountModel = require('../models/accountModel'),
  amqp = require('amqplib'),
  Stomp = require('webstomp-client'),
  ctx = {};

let accounts, amqpInstance;
describe('core/balance processor', function () {

  before(async () => {
    await clearMongoBlocks();
    amqpInstance = await amqp.connect(config.rabbit.url);
    let provider = new Web3.providers.IpcProvider(config.web3.uri, net);
    web3.setProvider(provider);

    accounts = await Promise.promisify(web3.eth.getAccounts)();
    await saveAccountForAddress(accounts[0]);
    return await awaitLastBlock(web3);
  });

  after(async () => {
    await clearMongoBlocks();
    web3.currentProvider.connection.end();
    return mongoose.disconnect();
  });

  afterEach(async () => {
      await clearQueues(amqpInstance);
  })


  it('send some eth from accounts(0 => 1) and validate balance changes and structure of messages', async () => {

    const checkTx = function (tx) {
        expect(tx).to.contain.all.keys(
          'hash',
          'nonce',
          'blockNumber',
          'from',
          'to',
          'value',
          'gas',
          'gasPrice',
          'input'
        );
        expect(tx.value).to.equal('100');
        expect(tx.from).to.equal(accounts[0]);
        expect(tx.to).to.equal(accounts[1]);
        expect(tx.nonce).to.be.a('number');
    },
    checkMessage = async function (content) {
      expect(content).to.have.all.keys(
        'address',
        'balance',
        'tx'
      );
      expect(content.address).to.equal(accounts[0]);
      const afterWeb3Balance = await Promise.promisify(web3.eth.getBalance)(accounts[0]);
      expect(content.balance).to.equal(afterWeb3Balance.toString());      
      checkTx(content.tx);
    };

    await syncBalanceForAddress(accounts[0], web3);
    const balanceBefore = await getBalanceForAddress(accounts[0]);

    ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[0],
      to: accounts[1],
      value: 100
    });

    expect(ctx.hash).to.be.string;

    await Promise.all([
      (async () => {

        const channel = await amqpInstance.createChannel();
        await connectToQueue(channel);
        
        return await new Promise(res =>
          channel.consume(
            `app_${config.rabbit.serviceName}_test.balance`, 
            async (message) => { 
              try{
                const balanceAfter = await getBalanceForAddress(accounts[0]);
                expect(balanceBefore.minus(balanceAfter).toNumber()).to.greaterThan(100);
                await checkMessage(JSON.parse(message.content), balanceAfter); 
              } catch (e) {
                  console.error(e);
              }
              await channel.cancel(message.fields.consumerTag);
              res();
            },
            {noAck: true}
        ));

      })(),
      (async () => {
        let ws = new WebSocket('ws://localhost:15674/ws');
        let client = Stomp.over(ws, {heartbeat: false, debug: false});
        return await new Promise(res =>
          client.connect('guest', 'guest', () => {
            const subscribe = client.subscribe(
              `/exchange/events/${config.rabbit.serviceName}_balance.*`, 
              async (message) => { 
                  try{
                    await checkMessage(JSON.parse(message.body)); 
                  } catch (e) {
                      console.error(e);
                  }
                  await subscribe.unsubscribe();
                  res();                  
              }
            );
          })
        );
      })()
    ]);


  });

  it('send some eth from non auth accounts (3 => 2) and not messages', async () => {
    ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[2],
      to: accounts[3],
      value: 100
    });
    expect(ctx.hash).to.be.string;

    const channel = await amqpInstance.createChannel();  
    const balanceQueue = await connectToQueue(channel);  
    expect(balanceQueue.messageCount).to.equal(0);

  });

  it('send some eth from reverse accounts(1 => 0) and  check that in database, that right user get the exact right amount of coins', async () => {
    await syncBalanceForAddress(accounts[0], web3);
    const balanceBefore = await getBalanceForAddress(accounts[0]);


    ctx.hash = await Promise.promisify(web3.eth.sendTransaction)({
      to: accounts[0],
      from: accounts[1],
      value: 500
    });
    expect(ctx.hash).to.be.string;

    const channel = await amqpInstance.createChannel();    
    await connectToQueue(channel);

    return await new Promise(res =>
      channel.consume(
        `app_${config.rabbit.serviceName}_test.balance`, 
        async (message) => { 
          try {
            const balanceAfter = await getBalanceForAddress(accounts[0]);
            expect(balanceAfter.minus(balanceBefore).toNumber()).to.equal(500);
          } catch (e) {
            console.error(e);
          }
          await channel.cancel(message.fields.consumerTag);
          return res(); 
        },
        {noAck: true}        
      )
    );

  });

});
