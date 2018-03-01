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
  consumeMessages = require('./helpers/consumeMessages'),
  consumeStompMessages = require('./helpers/consumeStompMessages'),
  net = require('net'),
  path = require('path'),
  Web3 = require('web3'),
  web3 = new Web3(),
  expect = require('chai').expect,
  WebSocket = require('ws'),
  accountModel = require('../models/accountModel'),
  amqp = require('amqplib'),
  Stomp = require('webstomp-client');

let accounts, amqpInstance;
describe('core/balance processor', function () {

  before(async () => {
    await clearMongoBlocks();
    amqpInstance = await amqp.connect(config.rabbit.url);
    let provider = new Web3.providers.IpcProvider(config.web3.uri, net);
    web3.setProvider(provider);

    accounts = await Promise.promisify(web3.eth.getAccounts)();
    await saveAccountForAddress(accounts[0]);
    await clearQueues(amqpInstance);
    //return await awaitLastBlock(web3);
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

    return await Promise.all([
      (async() => {
        const hash = await Promise.promisify(web3.eth.sendTransaction)({
          from: accounts[0],
          to: accounts[1],
          value: 100
        });
        expect(hash).to.be.string;
        expect(hash).to.be.not.undefined;
      })(),
      (async () => {
        const channel = await amqpInstance.createChannel();  
        await connectToQueue(channel);
        return await consumeMessages(1, channel, async (message) => {
          const balanceAfter = await getBalanceForAddress(accounts[0]);
          expect(balanceBefore.minus(balanceAfter).toNumber()).to.greaterThan(100);
          await checkMessage(JSON.parse(message.content), balanceAfter); 
        });
      })(),
      (async () => {
        const ws = new WebSocket('ws://localhost:15674/ws');
        const client = Stomp.over(ws, {heartbeat: false, debug: false});
        return await consumeStompMessages(1, client, async (message) => {
          await checkMessage(JSON.parse(message.body)); 
        });
      })()
    ]);



  });

  it('send some eth from non auth accounts (3 => 2) and not messages', async () => {
    await Promise.promisify(web3.eth.sendTransaction)({
      from: accounts[1],
      to: accounts[2],
      value: 100
    });
    Promise.delay(1000, async() => {
      const channel = await amqpInstance.createChannel();  
      const queue =await connectToQueue(channel); 
      expect(queue.messageCount).to.equal(0);
    });
  });

  it('send some eth from reverse accounts(1 => 0) and  check that in database, that right user get the exact right amount of coins', async () => {
    await syncBalanceForAddress(accounts[0], web3);
    const balanceBefore = await getBalanceForAddress(accounts[0]);

    return await Promise.all([
      (async() => {
        const hash = await Promise.promisify(web3.eth.sendTransaction)({
          from: accounts[1],
          to: accounts[0],
          value: 500
        });
        expect(hash).to.be.string;
        expect(hash).to.be.not.undefined;
      })(),
      (async () => {
        const channel = await amqpInstance.createChannel();  
        await connectToQueue(channel);
        return await consumeMessages(1, channel, async (message) => {
          const balanceAfter = await getBalanceForAddress(accounts[0]);
          expect(balanceAfter.minus(balanceBefore).toNumber()).to.equal(500);
        });
      })()
    ]);
  });

});
