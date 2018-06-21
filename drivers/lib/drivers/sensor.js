'use strict';

const Default = require('./default');

module.exports = Mixin(superclass => class Sensor extends mix(superclass).with(Default) {
	constructor(config) {
		super(config);
		Homey.manager('flow').on(`condition.${this.config.id}:state`, (callback, args) => {
			callback(null, this.parseState(this.getState(args.device).state));
		});
	}

	parseState(state) {
		return this.config.invertState ? !Boolean(Number(state)) : Boolean(Number(state));
	}

	updateRealtime(device, state, oldState) {
		if (Number(state.state) !== Number(oldState.state)) {
			this.sensorCapabilities.forEach(capability => {
				this.realtime(device, capability, this.parseState(state.state));
			});
		}
	}

	getExports() {
		const exports = super.getExports();
		this.sensorCapabilities = [];
		exports.capabilities = exports.capabilities || {};
		this.config.capabilities.forEach(capability => {
			if (!exports.capabilities.hasOwnProperty(capability)) {
				this.sensorCapabilities.push(capability);
				exports.capabilities[capability] = {
					get: (device, callback) => callback(null, this.parseState(this.getState(device).state)),
				};
			}
		});
		return exports;
	}
});
