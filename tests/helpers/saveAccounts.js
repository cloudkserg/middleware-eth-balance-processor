/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const accountModel = require('../../models/accountModel');
module.exports = async (accounts, TCAddress) => {
  await new accountModel.insertMany([{address: accounts[0], erc20token: {[TCAddress]: 0}}, {address: accounts[1]}]).catch(() => {});
};
