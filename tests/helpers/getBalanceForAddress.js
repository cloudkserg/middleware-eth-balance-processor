const accountModel = require('../../models/accountModel'),
    BigNumber = require('bignumber.js');
module.exports = async (address) => {
    account = await accountModel.findOne({address: address});
    return new BigNumber(account.balance);
};