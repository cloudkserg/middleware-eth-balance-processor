/**
 * Updates balances
 *
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
 */

const _ = require('lodash'),
  Promise = require('bluebird'),
  accountModel = require('../models/accountModel');

const TIMEOUT_WAIT=10000;

/**
 * Get balance from the network
 * @param  {Object} instance Web3 instance
 * @param  {string} acc      Account address
 * @return {number}          Actual Balance 
 */
const getBalance = async (instance, acc) => {
  const balance = await instance.balanceOf(acc);
  return balance.toNumber();
};

/**
 * Balance updater
 * @param  {Object} Erc20Contract Instance of ERC20 contract
 * @param  {string} erc20addr     Address of ERC20 contract
 * @param  {Object} payload       Payload of transaction
 * @return {array}                Array of objects {address, balance}
 */
const updateBalance = async (Erc20Contract, erc20addr, payload) => {
  const from = _.get(payload, 'from') || _.get(payload, 'owner'),
    to = _.get(payload, 'to') || _.get(payload, 'spender'),
    instance = await Erc20Contract.at(erc20addr);
    
  return await Promise.map([from, to], async address => {
    let obj = {};
    let balance = await getBalance(instance, address);
    obj[`erc20token.${erc20addr}`] = balance;
    await accountModel.findOneAndUpdate({address: address}, {$set: {[`erc20token.${erc20addr}`]: balance}});
    return {address, erc20token: erc20addr, balance};
  }).timeout(TIMEOUT_WAIT);
};

module.exports = updateBalance;
