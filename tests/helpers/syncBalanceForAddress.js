const accountModel = require('../../models/accountModel'),
    Promise = require('bluebird');
module.exports = async (address, web3) => {
    const balanceBefore = await Promise.promisify(web3.eth.getBalance)(address);
    await accountModel.update({address: address}, {$set: {balance: balanceBefore}});
};