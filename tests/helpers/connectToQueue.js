/** 
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
*/
const config = require('../../config');

module.exports = async (channel) => {
  await channel.assertExchange('events', 'topic', {durable: false});
  const processorQueue = await channel.assertQueue(`app_${config.rabbit.serviceName}_test.balance`);
  await channel.bindQueue(`app_${config.rabbit.serviceName}_test.balance`, 'events', `${config.rabbit.serviceName}_balance.*`);

  return processorQueue;
};
