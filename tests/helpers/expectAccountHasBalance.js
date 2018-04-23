/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const accountModel = require('../../models/accountModel'),
  expect = require('chai').expect;

module.exports = async (accountAddress, TCAddress, balance) => {
  let result = await accountModel.findOne({address: accountAddress});

  console.log(result, result['erc20token'], result['erc20token'][TCAddress], TCAddress);
  expect(result).to.be.not.null;
  expect(result).to.have.property('erc20token');
  //expect(result.erc20token).to.have.property(TCAddress);
  expect(result['erc20token'][TCAddress]).to.equal(balance);
};
