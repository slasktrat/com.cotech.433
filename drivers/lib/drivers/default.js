'use strict';

module.exports = Mixin(superclass => class Default extends superclass {
	constructor(config) {
		super(config);

		this.on('frame', this.updateState.bind(this));
		this.on('new_state', this.updateRealtime.bind(this));
		this.on('new_pairing_device', device => this.updateState(device.data));
	}

	updateState(frame) {
		this.setState(frame.id, Object.assign({}, this.getState(frame.id), frame));
	}

	updateRealtime(device, state, oldState) {
		if (Boolean(Number(state.state)) !== Boolean(Number(oldState.state))) {
			this.realtime(device, 'onoff', Boolean(Number(state.state)));
		}
	}
});
