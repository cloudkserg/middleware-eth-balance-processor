/**
 * Initialize all events for smartContracts
 * @module controllers/events
 */

const _ = require('lodash'),
  utils = require('web3/lib/utils/utils.js'),
  Web3 = require('web3'),
  web3 = new Web3(),
  config = require('../config'),
  mongoose = require('mongoose');

/**
 * Process all Smart Contracts, exstracts signatures and builds Event Models
 * @param  {array} contracts Instances of Smart Contracts
 * @return {Object} Returns {eventModels, signatures} 
 */
module.exports = (contracts) => {

  let eventModels = _.chain(contracts)
    .get('abi')
    .filter({type: 'event'})
    .groupBy('name')
    .map(ev => ({
      name: ev[0].name,
      inputs: _.chain(ev)
        .map(ev => ev.inputs)
        .flattenDeep()
        .uniqBy('name')
        .value()
    }))
    .transform((result, ev) => { //build mongo model, based on event definition from abi
      result[ev.name] = mongoose.model(ev.name, new mongoose.Schema(
        _.chain(ev.inputs)
          .transform((result, obj) => {
            result[obj.name] = {
              type: new RegExp(/uint/).test(obj.type) ?
                Number : mongoose.Schema.Types.Mixed
            };
          }, {})
          .merge({
            controlIndexHash: {type: String, unique: true, required: true},
            network: {type: String},
            created: {type: Date, required: true, default: Date.now, expires: config.smartContracts.events.ttl}
          })
          .value()
      ));
    }, {})
    .value();

  let signatures = _.chain(contracts) //transform event definition to the following object {encoded_event_signature: event_definition}
    .get('abi')
    .filter({type: 'event'})
    .transform((result, ev) => {
      result[web3.sha3(utils.transformToFullName(ev))] = ev;
    }, {})
    .value();
    
  return {eventModels, signatures};

};
