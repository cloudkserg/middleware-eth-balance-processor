/**
 * Filtering transactions by smart contract events
 *
 * @module services/filterTxsBySMEvents
 * @param {Object} tx Array of transactions
 * @param {Object} web3 Instance of Web3
 * @returns {array} Array of filtered transactions
 *
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Kirill Sergeev <cloudkserg11@gmail.com>
 */

const _ = require('lodash'),
  solidityEvent = require('../node_modules/web3/lib/web3/event.js'),
  config = require('../config');

module.exports = (tx, web3, smEvents) => {
  if (_.get(tx, 'logs', []).length === 0)
    return [];

  return _.chain(tx.logs)
    .map(ev => {
      let signatureDefinition = smEvents.signatures[ev.topics[0]];

      if (!signatureDefinition)
        return;

      _.pullAt(ev, 0);
      let resultDecoded = new solidityEvent(null, signatureDefinition).decode(ev);


      return _.chain(resultDecoded)
        .pick(['event', 'args'])
        .merge({args: {controlIndexHash: `${ev.logIndex}:${ev.transactionHash}:${web3.sha3(config.web3.network)}`}})
        .thru(ev => ({
          name: ev.event,
          payload: new smEvents.eventModels[ev.event](_.merge(ev.args, {network: config.web3.network}))
        }))
        .value();
    })
    .filter(ev=>_.has(ev, 'payload'))
    .value();

};
