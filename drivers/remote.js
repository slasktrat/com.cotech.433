'use strict';

const Cotech = require('./cotech');
const DefaultDriver = require('./lib/drivers/default');

module.exports = class Remote extends mix(Cotech).with(DefaultDriver) {

	payloadToData(payload) { // Convert received data to usable variables
		const data = super.payloadToData(payload);
		if (data) {
			data.id = data.uuid;
		}
		return data;
	}

};
