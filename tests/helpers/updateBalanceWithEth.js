/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const accountModel = require('../../models/accountModel'),
  BigNumber = require('bignumber.js'),
  Promise = require('bluebird');
module.exports = async (account, web3) => {
  let balance = await Promise.promisify(web3.eth.getBalance)(account);
  const newAccount = await accountModel.findOneAndUpdate({address: account}, {$set: {balance}}, {new: true});
  return new BigNumber(newAccount.balance);
};
