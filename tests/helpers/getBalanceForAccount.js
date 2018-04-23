/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const accountModel = require('../../models/accountModel'),
  BigNumber = require('bignumber.js');
module.exports = async (address) => {
  const account = await accountModel.findOne({address: address});
  return new BigNumber(account['balance']);
};
