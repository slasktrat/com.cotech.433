'use strict';

const Default = require('./default');

module.exports = Mixin(superclass => class Toggle extends mix(superclass).with(Default) {
	getExports() {
		const exports = super.getExports();
		exports.capabilities = exports.capabilities || {};
		exports.capabilities.onoff = {
			get: (device, callback) => callback(null, Boolean(Number(this.getState(device).state))),
			set: (device, state, callback) => this.send(device, { state: state ? 1 : 0 }, () => callback(null, state)),
		};
		return exports;
	}
});
