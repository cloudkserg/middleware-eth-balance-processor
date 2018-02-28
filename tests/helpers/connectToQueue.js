const config = require('../../config');

module.exports = async (channel) => {
    await channel.assertExchange('events', 'topic', {durable: false});
    const balanceQueue = await channel.assertQueue(`app_${config.rabbit.serviceName}_test.balance`);
    await channel.bindQueue(`app_${config.rabbit.serviceName}_test.balance`, 'events', `${config.rabbit.serviceName}_balance.*`);
    return balanceQueue;
};