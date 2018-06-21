'use strict';

const Default = require('./default');

module.exports = Mixin(superclass => class Socket extends mix(superclass).with(Default) {
	constructor(config) {
		super(config);
		this.toggleTimeout = {};
		this.on('frame', (frame) => this.sendToggleAfterTimeout(frame.id, frame));
	}

	sendToggleAfterTimeout(deviceId, frame) {
		if (
			Number(frame.state) === 1 &&
			(this.isPairing || this.getDevice(deviceId, true))
		) {
			clearTimeout(this.toggleTimeout[deviceId]);
			this.toggleTimeout[deviceId] = setTimeout(
				() =>	this.getDevice(deviceId, true) && this.emit(
					'frame',
					Object.assign({}, this.getLastFrame(deviceId) || this.getDevice(deviceId, true), { state: 0, toggle: true })
				),
				4000
			);
		}
	}

	updateRealtime(device, state, oldState) {
		super.updateRealtime(device, state, oldState);
		if (Boolean(Number(state.state)) !== Boolean(Number(oldState.state))) {
			this.realtime(device, 'generic_alarm', Boolean(Number(state.state)));
		}
	}

	onTriggerReceived(callback, args, state) {
		if (args.state === 1) {
			super.onTriggerReceived(callback, args, state);
		} else {
			callback(null, false);
		}
	}

	onActionSend(callback, args) {
		args.state = 1;
		super.onActionSend(callback, args);
	}

	generateDevice(data) {
		if (data.toggle) {
			return null;
		}
		return super.generateDevice(data);
	}

	getExports() {
		const exports = super.getExports();
		exports.capabilities = {};
		exports.capabilities.generic_alarm = {
			get: (device, callback) => callback(null, Boolean(Number(this.getState(device).state))),
			set: (device, state, callback) => this.send(device, { state: state ? 1 : 0 }, () => callback(null, state)),
		};

		return exports;
	}
});
