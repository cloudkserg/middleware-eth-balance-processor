/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const accountModel = require('../../models/accountModel'),
  BigNumber = require('bignumber.js');
module.exports = async (account, TC) => {
  const balance = await TC.balanceOf.call(account);
  const newAccount = await accountModel.findOneAndUpdate({address: account}, {$set: {
    [`erc20token.${TC.address}`]: balance}}, {new: true});
  return new BigNumber(newAccount['erc20token'][TC.address]);
};
