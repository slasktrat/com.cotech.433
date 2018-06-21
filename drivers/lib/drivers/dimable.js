'use strict';

const Toggle = require('./toggle');
const Signal = require('../signal');

module.exports = Mixin(superclass => class Dimmable extends mix(superclass).with(Toggle) {
	constructor(config) {
		super(config);

		if (this.config.alternativeSignal) {
			// Create non-dimming remote signal to catch the payload_send event from this signal
			this.alternativeSignal = new Signal(
				this.config.alternativeSignal,
				this.payloadToData.bind(this),
				this.config.debounceTimeout
			);

			this.alternativeSignal.on('payload_send', payload => {
				const frame = this.payloadToData(payload);
				this.emit('frame', frame);
				this.emit('frame_send', frame);
			});
		}
	}

	updateState(frame) {
		if (frame.dim === undefined || frame.dim === null) {
			delete frame.dim;
		}
		this.setState(frame.id, Object.assign({}, this.getState(frame.id), frame));
	}

	updateRealtime(device, state, oldState) {
		super.updateRealtime(device, state, oldState);
		if (state.dim === undefined || state.dim === null) {
			if (oldState.dim === undefined || oldState.dim === null && Number(state.state) !== Number(oldState.state)) {
				this.realtime(device, 'dim', Number(state.state));
			}
		} else if (state.dim !== oldState.dim) {
			this.realtime(device, 'dim', state.dim);
		}
	}

	getExports() {
		const exports = super.getExports();
		let sendLock = false;
		let sendLockTimeout;
		exports.capabilities = exports.capabilities || {};
		exports.capabilities.onoff = {
			get: (device, callback) => callback(null, Boolean(Number(this.getState(device).state))),
			set: (device, state, callback) => {
				setTimeout(() => {
					// enforce that change brightness flow only sends dim signal
					// This is done by delaying onoff command and checking if dim has been called <50ms before/after onoff
					if (sendLock) return callback(null, true);

					let dim = this.getState(device).dim;
					if (dim === undefined) {
						dim = 1;
					}
					this.send(device, state ? { dim: dim } : { state: 0, dim: undefined }, () => callback(null, state));
				}, 100);
			},
		};
		exports.capabilities.dim = {
			get: (device, callback) => {
				const state = this.getState(device);
				callback(null, typeof state.dim === 'number' ? state.dim : Number(state.state));
			},
			set: (device, state, callback) => {
				sendLock = true;
				clearTimeout(sendLockTimeout);
				sendLockTimeout = setTimeout(() => sendLock = false, 200);
				this.send(device, { dim: state }, () => callback(null, state));
			},
		};
		return exports;
	}
});
