'use strict';

const mixWith = require('./mixwith/mixwith');
global.mix = mixWith.mix;
global.Mixin = mixWith.Mixin;

const EventEmitter = require('events').EventEmitter;
const Signal = require('./signal');
const logLevelMap = new Map([['silly', 1], ['debug', 2], ['verbose', 3], ['info', 4], ['warn', 5], ['error', 6]]);
const sentryLevelMap = new Map([[1, 'debug'], [2, 'debug'], [3, 'debug'], [4, 'info'], [5, 'warning'], [6, 'error']]);
const logLevelNameMap = new Map(
	Array.from(logLevelMap.entries()).map(entry => [entry[1], entry[0][0].toUpperCase().concat(entry[0].slice(1))])
);

if (process.env.DEBUG === '1') {
	const pjson = require('./package.json'); // eslint-disable-line
	const http = require('http'); // eslint-disable-line

	const options = {
		hostname: 'registry.npmjs.org',
		path: `/${pjson.name}/latest`,
		method: 'GET',
		headers: { 'Content-Type': 'application/json' },
	};

	const req = http.request(options, res => {
		res.setEncoding('utf8');
		res.on('data', dataString => {
			try {
				const data = JSON.parse(dataString);
				if (data.version !== pjson.version) {
					console.log(
						`\x1b[33mA newer version of the 433 generator is available (${pjson.version} -> ${data.version}).\n` +
						'Please run \'npm install -g homey-433\' and \'homey433 generate\' in your project folder to update!\x1b[0m'
					);
				}
			} catch (e) {
				return; // ignore
			}
		});
	});
	req.on('error', e => null);
	req.end();
}

module.exports = class Driver extends EventEmitter {
	constructor(driverConfig) {
		super();
		if (!driverConfig) {
			throw new Error('No deviceconfig found in constructor. Make sure you pass config to super call!');
		}
		this.config = driverConfig;
		this.devices = new Map();
		this.state = new Map();
		this.lastFrame = new Map();
		this.settings = new Map();
		this.driverState = {};
		this.isPairing = false;

		this.logLevel = 4;
		this.captureLevel = 5;
		this.logger = {
			setTags: (() => null),
			setUser: (() => null),
			setExtra: (() => null),
			captureMessage: (() => null),
			captureException: (() => null),
			log: (function log(level) {
				const args = Array.prototype.slice.call(arguments, logLevelMap.has(level) ? 1 : 0);
				const logLevelId = logLevelMap.get(level) || 4;

				if (this.logLevel <= logLevelId) {
					if (logLevelId === 6) {
						if (args[0] instanceof Error) {
							Homey.error(`[${logLevelNameMap.get(logLevelId)}]`, args[0].message, args[0].stack);
						} else {
							Homey.error.apply(null, [`[${logLevelNameMap.get(logLevelId)}]`].concat(args));
						}
					} else {
						Homey.log.apply(null, [`[${logLevelNameMap.get(logLevelId)}]`].concat(args));
					}
				}
				if (this.captureLevel <= logLevelId) {
					if (logLevelId === 6 && args[0] instanceof Error) {
						this.logger.captureException(
							args[0],
							Object.assign({ level: sentryLevelMap.get(logLevelId) }, typeof args[1] === 'object' ? args[1] : null)
						);
					} else {
						this.logger.captureMessage(Array.prototype.join.call(args, ' '), { level: sentryLevelMap.get(logLevelId) });
					}
				}
			}).bind(this),
			silly: (function silly() {
				if (this.captureLevel <= 1 || this.logLevel <= 1) {
					this.logger.log.bind(null, 'silly').apply(null, arguments);
				}
			}).bind(this),
			debug: (function debug() {
				if (this.captureLevel <= 2 || this.logLevel <= 2) {
					this.logger.log.bind(null, 'debug').apply(null, arguments);
				}
			}).bind(this),
			verbose: (function verbose() {
				if (this.captureLevel <= 3 || this.logLevel <= 3) {
					this.logger.log.bind(null, 'verbose').apply(null, arguments);
				}
			}).bind(this),
			info: (function info() {
				if (this.captureLevel <= 4 || this.logLevel <= 4) {
					this.logger.log.bind(null, 'info').apply(null, arguments);
				}
			}).bind(this),
			warn: (function warn() {
				if (this.captureLevel <= 5 || this.logLevel <= 5) {
					this.logger.log.bind(null, 'warn').apply(null, arguments);
				}
			}).bind(this),
			error: (function error() {
				if (this.captureLevel <= 6 || this.logLevel <= 6) {
					this.logger.log.bind(null, 'error').apply(null, arguments);
				}
			}).bind(this),
		};

		if (typeof Homey.env.HOMEY_LOG_URL === 'string') {
			const logger = require('homey-log').Log; // eslint-disable-line
			this.logger.setTags = logger.setTags.bind(logger);
			this.logger.setUser = logger.setUser.bind(logger);
			this.logger.setExtra = logger.setExtra.bind(logger);
			this.logger.captureMessage = logger.captureMessage.bind(logger);
			this.logger.captureException = logger.captureException.bind(logger);
		}

		this.on('frame', (frame) => {
			this.setLastFrame(frame.id, frame);
		});
	}

	init(exports, connectedDevices, callback) {
		this.logger.silly('Driver:init(exports, connectedDevices, callback)', exports, connectedDevices, callback);
		if (this.config.logLevel) {
			if (!isNaN(this.config.logLevel)) {
				this.logLevel = Number(this.config.logLevel);
			} else if (logLevelMap.has(this.config.logLevel)) {
				this.logLevel = logLevelMap.get(this.config.logLevel);
			}
		}
		if (this.config.captureLevel) {
			if (!isNaN(this.config.captureLevel)) {
				this.captureLevel = Number(this.config.captureLevel);
			} else if (logLevelMap.has(this.config.captureLevel)) {
				this.captureLevel = logLevelMap.get(this.config.captureLevel);
			}
		}
		Homey.log(
			'Initializing driver for', (this.config.id + ' '.repeat(20)).slice(0, 20),
			'with log level', logLevelNameMap.get(this.logLevel),
			'and capture level', logLevelNameMap.get(this.captureLevel)
		);
		this.realtime = (device, cap, val) => this.getDevice(device) && exports.realtime(this.getDevice(device), cap, val);
		this.setAvailable = device => this.getDevice(device) && exports.setAvailable(this.getDevice(device));
		this.setUnavailable = (device, message) => this.getDevice(device) && exports.setUnavailable(this.getDevice(device), message);
		this.getName = (device, callback) => this.getDevice(device) && exports.getName(this.getDevice(device), callback);
		this.getSettingsExt = (device, callback) => (this.getDevice(device) &&
			exports.getSettings(this.getDevice(device), callback)
		) || (callback && callback(new Error('device id does not exist')));
		this.setSettingsExt = (device, settings, callback) => (this.getDevice(device) &&
			exports.setSettings(this.getDevice(device), settings, callback)
		) || (callback && callback(new Error('device id does not exist')));

		this.signal = new Signal(
			this.config.signal,
			this.payloadToData.bind(this),
			this.config.debounceTimeout || 500,
			this.logger
		);

		connectedDevices.forEach(this.add.bind(this));

		this.signal.on('error', (err) => {
			this.logger.error(err);
			this.emit('signal_error');
		});
		this.signal.on('data', (frame) => {
			this.logger.verbose('Driver->data', frame);
			this.received(frame);
			this.emit('frame', frame);
		});
		this.signal.on('payload_send', payload => {
			this.logger.verbose('Driver->payload_send', payload);
			const frame = this.payloadToData(payload);
			if (frame) {
				this.emit('frame', frame);
				this.emit('frame_send', frame);
			}
		});

		if (this.config.triggers && this.config.triggers.find(trigger => trigger.id === `${this.config.id}:received`)) {
			this.on('device_frame_received', (device, data) => {
				this.logger.verbose('Driver->device_frame_received(device, data)', device, data);
				this.handleReceivedTrigger(device, data);
			});
			Homey.manager('flow').on(`trigger.${this.config.id}:received`, (callback, args, state) => {
				this.logger.verbose(
					`Driver->trigger.${this.config.id}:received(callback, args, state)`, callback, args, state
				);
				this.onTriggerReceived(callback, args, state);
			});
		}
		if (this.config.actions && this.config.actions.find(actions => actions.id === `${this.config.id}:send`)) {
			Homey.manager('flow').on(`action.${this.config.id}:send`, (callback, args) => {
				this.logger.verbose(`Driver->action.${this.config.id}:send(callback, args)`, callback, args);
				this.onActionSend(callback, args);
			});
		}

		if (callback) {
			callback();
		}
	}

	add(device) {
		this.logger.silly('Driver:add(device)', device);
		this.logger.info('adding device', device);
		const id = this.getDeviceId(device);
		const lastFrame = this.getLastFrame(device);
		const state = this.getState(device);
		this.devices.set(id, device.data || device);
		this.setState(id, state || {});
		this.setLastFrame(id, lastFrame || Object.assign({}, device.data));
		this.getSettingsExt(id, (err, settings) => this.updateSettings(id, settings));
		this.registerSignal();
		this.emit('added', Object.assign({ id }, this.getDevice(id)));
		this.logger.setExtra(
			{ [this.config.id]: Object.assign(this.driverState, { devices: Array.from(this.devices.entries()) }) }
		);
	}

	get(device) {
		this.logger.silly('Driver:get(device)', device);
		const id = this.getDeviceId(device);
		if (this.devices.has(id)) {
			return Object.assign({}, this.getDevice(id), { state: this.getState(id), lastFrame: this.getLastFrame(id) });
		}
		return null;
	}

	getDevice(device, includePairing) {
		this.logger.silly('Driver:getDevice(device, includePairing)', device, includePairing);
		const id = this.getDeviceId(device);
		if (this.devices.has(id)) {
			return this.devices.get(id);
		} else if (includePairing && this.pairingDevice && this.pairingDevice.data && this.pairingDevice.data.id === id) {
			return this.pairingDevice.data;
		}
		return null;
	}

	getDeviceId(device) {
		this.logger.silly('Driver:getDeviceId(device)', device);
		if (device && device.constructor) {
			if (device.constructor.name === 'Object') {
				if (device.id) {
					return device.id;
				} else if (device.data && device.data.id) {
					return device.data.id;
				}
			} else if (device.constructor.name === 'String') {
				return device;
			}
		}
		return null;
	}

	getState(device) {
		this.logger.silly('Driver:getState(device)', device);
		const id = this.getDeviceId(device);
		device = this.getDevice(id);
		if (device && this.state.has(id)) {
			return this.state.get(id) || {};
		} else if (this.pairingDevice && this.pairingDevice.data.id === id) {
			return this.state.get('_pairingDevice') || {};
		}
		return Homey.manager('settings').get(`${this.config.name}:${id}:state`) || {};
	}

	setState(device, state) {
		this.logger.silly('Driver:setState(device, state)', device, state);
		const id = this.getDeviceId(device);
		device = this.getDevice(id);
		if (device) {
			if (this.state.has(id)) {
				this.emit('new_state', device, state, this.state.get(id) || {});
			}
			this.state.set(id, state);
			Homey.manager('settings').set(`${this.config.name}:${id}:state`, state);
		}
		if (this.pairingDevice && this.pairingDevice.data.id === id) {
			if (this.state.has('_pairingDevice')) {
				this.emit('new_state', this.pairingDevice.data, state, this.state.get('_pairingDevice') || {});
			}
			this.state.set('_pairingDevice', state);
		}
		this.logger.setExtra(
			{ [this.config.id]: Object.assign(this.driverState, { state: Array.from(this.state.entries()) }) }
		);
	}

	getLastFrame(device) {
		this.logger.silly('Driver:getLastFrame(device)', device);
		const id = this.getDeviceId(device);
		device = this.getDevice(id);
		if (device && this.lastFrame.has(id)) {
			return this.lastFrame.get(id);
		} else if (this.pairingDevice && this.pairingDevice.data.id === id) {
			return this.lastFrame.get('_pairingDevice');
		}
		return Homey.manager('settings').get(`${this.config.name}:${id}:lastFrame`) || {};
	}

	setLastFrame(device, frame) {
		this.logger.silly('Driver:setLastFrame(device, frame)', device, frame);
		const id = this.getDeviceId(device);
		device = this.getDevice(id);
		if (device) {
			if (this.lastFrame.has(id)) {
				this.emit('new_frame', device, frame, this.lastFrame.get(id));
			}
			this.lastFrame.set(id, frame);
			Homey.manager('settings').set(`${this.config.name}:${id}:lastFrame`, frame);
		}
		if (this.pairingDevice && this.pairingDevice.data.id === id) {
			if (this.lastFrame.has('_pairingDevice')) {
				this.emit('new_frame', this.pairingDevice.data, frame, this.lastFrame.get('_pairingDevice'));
			}
			this.lastFrame.set('_pairingDevice', frame);
		}
		this.logger.setExtra(
			{ [this.config.id]: Object.assign(this.driverState, { lastFrame: Array.from(this.lastFrame.entries()) }) }
		);
	}

	deleted(device) {
		this.logger.silly('Driver:deleted(device)', device);
		this.logger.info('deleting device', device);
		const id = this.getDeviceId(device);
		const target = Object.assign({ id }, this.getDevice(id));
		this.devices.delete(id);
		this.state.delete(id);
		this.lastFrame.delete(id);
		this.settings.delete(id);
		this.unregisterSignal();
		this.emit('deleted', target);
		this.logger.setExtra(
			{ [this.config.id]: Object.assign(this.driverState, { devices: Array.from(this.devices.entries()) }) }
		);
	}

	received(data) {
		this.logger.silly('Driver:received(data)', data);
		this.emit('frame_received', data);
		const device = this.getDevice(data.id);
		if (device) {
			this.emit('device_frame_received', device, data);
		}
	}

	send(device, data, callback, options) {
		this.logger.silly('Driver:send(device, data, callback, options)', device, data, callback, options);
		return new Promise((resolve, reject) => {
			callback = typeof callback === 'function' ? callback : () => null;
			options = options || {};
			data = Object.assign({}, this.getDevice(device, true) || device.data || device, data);
			this.emit('before_send', data);

			const payload = this.dataToPayload(data);
			if (!payload) {
				const err = new Error(`DataToPayload(${JSON.stringify(data)}) gave empty response: ${payload}`);
				this.logger.error(err);
				reject(err);
				this.setUnavailable(device, __('433_generator.error.invalid_device'));
				return callback(err);
			}
			const frame = payload.map(Number);
			const dataCheck = this.payloadToData(frame);
			if (
				frame.find(isNaN) || !dataCheck ||
				dataCheck.constructor !== Object || !dataCheck.id ||
				dataCheck.id !== this.getDeviceId(device)
			) {
				const err = new Error(`Incorrect frame from dataToPayload(${JSON.stringify(data)}) => ${frame} => ${
					JSON.stringify(dataCheck)}`);
				this.logger.error(err);
				reject(err);
				this.setUnavailable(device, __('433_generator.error.invalid_device'));
				return callback(true);
			}
			if (typeof options.beforeSendData === 'function') {
				options.beforeSendData(data, frame);
			}
			this.emit('send', data);
			resolve((options.signal || this.signal).send(frame).then(result => {
				if (callback) callback(null, result);
				if (typeof options.afterSendData === 'function') {
					options.afterSendData(data);
				}
				this.emit('after_send', data);
			}).catch(err => {
				this.logger.error(err);
				if (callback) callback(err);
				this.emit('error', err);
				throw err;
			}));
		}).catch((e) => {
			setTimeout(() => {
				throw e;
			});
		});
	}

	generateDevice(data) {
		this.logger.silly('Driver:generateDevice(data)', data);
		return {
			name: __(this.config.name),
			data: Object.assign({ overridden: false }, data, { driver_id: this.config.id }),
		};
	}

	assertDevice(device, callback) {
		this.logger.silly('Driver:assertDevice(device, callback)', device, callback);
		if (!device || !this.getDeviceId(device)) {
			callback(new Error('433_generator.error.no_device'));
		} else if (this.getDevice(device)) {
			callback(new Error('433_generator.error.device_exists'));
		} else if (!this.dataToPayload(device.data || device)) {
			callback(new Error('433_generator.error.invalid_data'));
		} else {
			callback(null, device);
		}
	}

	// TODO document that this function should be overwritten
	codewheelsToData(codewheelIndexes) { // Convert user set bitswitches to usable data object
		throw new Error(
			`codewheelsToData(codewheelIndexes) should be overwritten by own driver for device ${this.config.id}`
		);
	}

	// TODO document that this function should be overwritten
	dipswitchesToData(dipswitches) { // Convert user set bitswitches to usable data object
		throw new Error(`dipswitchToData(dipswitches) should be overwritten by own driver for device ${this.config.id}`);
	}

	// TODO document that this function should be overwritten
	payloadToData(payload) { // Convert received data to usable variables
		throw new Error(`payloadToData(payload) should be overwritten by own driver for device ${this.config.id}`);
	}

	// TODO document that this function should be overwritten
	dataToPayload(data) { // Convert received data to usable variables
		throw new Error(`dataToPayload(data) should be overwritten by own driver for device ${this.config.id}`);
	}

	// TODO document that this function should be overwritten
	generateData() {
		throw new Error(`generateData() should be overwritten by own driver for device ${this.config.id}`);
	}

	sendProgramSignal(device, callback) {
		this.logger.silly('Driver:sendProgramSignal(device, callback)', device, callback);
		const exports = this.getExports();
		if (exports.capabilities) {
			Object.keys(exports.capabilities).forEach(capability => {
				if (exports.capabilities[capability].get && exports.capabilities[capability].set) {
					exports.capabilities[capability].get(device, (err, result) => {
						if (typeof result === 'boolean') {
							this.logger.info(
								'sending program',
								`capabilities.${capability}.set(${JSON.stringify(device)}, true, ${callback})`
							);
							exports.capabilities[capability].set(device, true, callback);
						}
					});
				}
			});
		} else {
			this.logger.warn('Device does not have boolean capability');
			callback(new Error('Device does not have boolean capability'));
		}
		callback(null, true);
	}

	pair(socket) { // Pair sequence
		this.logger.verbose('Driver:pair(socket)', socket);
		this.logger.info('opening pair wizard');
		this.isPairing = true;
		this.registerSignal();
		const receivedListener = (frame) => {
			this.logger.verbose('emitting frame to pairing wizard', frame);
			socket.emit('frame', frame);
		};

		this.on('frame', receivedListener);

		socket.on('next', (data, callback) => {
			this.logger.verbose('Driver:pair->next(data, callback)', data, callback);
			socket.emit('nextView', this.config.pair.views.map(view => view.id));
			callback();
		});

		socket.on('previous', (data, callback) => {
			this.logger.verbose('Driver:pair->previous(data, callback)', data, callback);
			socket.emit('previousView', this.config.pair.views.map(view => view.id));
			callback();
		});

		socket.on('set_device', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->set_device(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (this.getDevice(data)) {
				return callback(new Error('433_generator.error.device_exists'));
			}
			const device = this.generateDevice(data);
			if (!device) {
				return callback(new Error('433_generator.error.invalid_device'));
			}

			this.pairingDevice = device;
			this.setLastFrame(device, data);
			this.emit('new_pairing_device', this.pairingDevice);
			return callback(null, this.pairingDevice);
		});

		socket.on('set_device_dipswitches', (dipswitches, callback) => {
			this.logger.verbose(
				'Driver:pair->set_device_dipswitches(dipswitches, callback)+this.pairingDevice',
				dipswitches, callback, this.pairingDevice
			);
			const data = this.dipswitchesToData(dipswitches.slice(0));
			if (!data) return callback(new Error('433_generator.error.invalid_dipswitch'));
			const device = this.generateDevice(Object.assign({ dipswitches: dipswitches }, data));
			if (!device) {
				return callback(new Error('433_generator.error.invalid_device'));
			}

			this.pairingDevice = device;
			this.setLastFrame(device, data);
			this.emit('new_pairing_device', this.pairingDevice);
			return callback(null, this.pairingDevice);
		});

		socket.on('set_device_codewheels', (codewheelIndexes, callback) => {
			this.logger.verbose(
				'Driver:pair->set_device_codewheels(codewheelIndexes, callback)+this.pairingDevice',
				codewheelIndexes, callback, this.pairingDevice
			);
			const data = this.codewheelsToData(codewheelIndexes.slice(0));
			if (!data) return callback(new Error('433_generator.error.invalid_codewheelIndexes'));
			const device = this.generateDevice(Object.assign({ codewheelIndexes }, data));
			if (!device) {
				return callback(new Error('433_generator.error.invalid_device'));
			}

			this.pairingDevice = device;
			this.setLastFrame(device, data);
			this.emit('new_pairing_device', this.pairingDevice);
			return callback(null, this.pairingDevice);
		});

		socket.on('get_device', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->get_device(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			callback(null, this.pairingDevice);
		});

		socket.on('program', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->program(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			let device;
			do {
				device = this.generateDevice(Object.assign(this.generateData(), { generated: true }));
			} while (this.get(device));
			if (!device) {
				return callback(new Error('433_generator.error.invalid_device'));
			}

			this.pairingDevice = device;
			this.setLastFrame(device, data);
			this.emit('new_pairing_device', this.pairingDevice);
			callback(null, this.pairingDevice);
		});

		socket.on('program_send', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->program_send(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (this.pairingDevice && this.pairingDevice.data) {
				return this.sendProgramSignal(this.pairingDevice.data, callback);
			}
			return callback(new Error('433_generator.error.no_device'));
		});

		socket.on('test', (data, callback) => {
			this.logger.verbose('Driver:pair->test(data, callback)+this.pairingDevice', data, callback, this.pairingDevice);
			callback(
				!this.pairingDevice,
				this.pairingDevice ?
					Object.assign(
						{},
						this.pairingDevice,
						{ data: Object.assign({}, this.pairingDevice.data, this.getLastFrame(this.pairingDevice)) || {} }
					) :
					null
			);
		});

		socket.on('override_device', (data, callback) => {
			if (!this.pairingDevice) {
				return callback(new Error('433_generator.error.no_device'));
			}
			if (!(data && data.constructor === Object)) {
				return callback(new Error('Data must be an object!'), this.pairingDevice.data);
			}
			const newPairingDeviceData = Object.assign({}, this.pairingDevice.data, data, { overridden: true });
			const payload = this.dataToPayload(newPairingDeviceData);
			if (!payload) {
				return callback(
					new Error('New pairing device data is invalid, changes are reverted.'),
					this.pairingDevice.data
				);
			}
			const frame = payload.map(Number);
			const dataCheck = this.payloadToData(frame);
			if (
				frame.find(isNaN) || !dataCheck ||
				dataCheck.constructor !== Object || !dataCheck.id ||
				dataCheck.id !== this.getDeviceId(newPairingDeviceData)
			) {
				return callback(
					new Error('New pairing device data is invalid, changes are reverted.'),
					this.pairingDevice.data
				);
			}
			this.pairingDevice.data = newPairingDeviceData;
			callback(null, this.pairingDevice.data);
		});

		socket.on('done', (data, callback) => {
			this.logger.verbose('Driver:pair->done(data, callback)+this.pairingDevice', data, callback, this.pairingDevice);
			if (!this.pairingDevice) {
				return callback(new Error('433_generator.error.no_device'));
			}
			return callback(null, this.pairingDevice);
		});

		socket.on('send', (data, callback) => {
			this.logger.verbose('Driver:pair->send(data, callback)+this.pairingDevice', data, callback, this.pairingDevice);
			if (this.pairingDevice && this.pairingDevice.data) {
				this.send(this.pairingDevice.data, data).then(callback.bind(false)).catch(callback);
			}
			return callback(new Error('433_generator.error.no_device'));
		});

		socket.on('set_settings', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->set_settings(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (this.pairingDevice && this.pairingDevice.data) {
				this.setSettings(this.pairingDevice.data.id, data, callback);
			} else {
				callback(new Error('433_generator.error.no_device'));
			}
		});

		socket.on('get_settings', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->get_settings(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (!this.pairingDevice) {
				return callback(new Error('433_generator.error.no_device'));
			}
			return callback(null, this.getSettings(this.pairingDevice));
		});

		socket.on('get_setting', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->get_setting(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (!this.pairingDevice) {
				return callback(new Error('433_generator.error.no_device'));
			}
			return callback(null, this.getSettings(this.pairingDevice)[data]);
		});

		socket.on('emulate_frame', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->emulate_frame(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (!this.pairingDevice) {
				return callback(new Error('433_generator.error.no_device'));
			}
			return callback(
				null,
				this.emit(
					'frame',
					Object.assign({}, this.pairingDevice, this.getLastFrame(this.pairingDevice) || {}, data || {})
				)
			);
		});

		socket.on('assert_device', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->assert_device(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			this.assertDevice(this.pairingDevice, callback);
		});

		const exports = this.getExports() || {};
		socket.on('toggle', (data, callback) => {
			this.logger.verbose(
				'Driver:pair->toggle(data, callback)+this.pairingDevice', data, callback, this.pairingDevice
			);
			if (!this.pairingDevice) {
				return callback(new Error('433_generator.error.no_device'));
			}
			if (exports.capabilities) {
				Object.keys(exports.capabilities).forEach(capability => {
					if (exports.capabilities[capability].get && exports.capabilities[capability].set) {
						exports.capabilities[capability].get(this.pairingDevice.data, (err, result) => {
							if (typeof result === 'boolean') {
								exports.capabilities[capability].set(this.pairingDevice.data, !result, callback);
							}
						});
					}
				});
			} else {
				callback(new Error('Device does not have boolean capability'));
			}
			callback(null, true);
		});

		Object.keys(exports.capabilities || {}).forEach(capability => {
			socket.on(capability, (data, callback) => {
				exports.capabilities[capability].set(this.pairingDevice.data, data, callback);
			});
		});

		const highlightListener = data => {
			this.logger.verbose('emitting highlight to pairing wizard', data);
			socket.emit('highlight', data);
		};
		this.on('highlight', highlightListener);

		socket.on('disconnect', (data, callback) => {
			this.logger.verbose('Driver:pair->toggle(data, callback)+this.pairingDevice', data, callback, this.pairingDevice);
			this.isPairing = false;
			this.removeListener('frame', receivedListener);
			this.removeListener('highlight', highlightListener);
			this.pairingDevice = null;
			this.state.delete('_pairingDevice');
			this.lastFrame.delete('_pairingDevice');
			this.unregisterSignal();
			this.logger.info('pair wizard closed');
			callback();
		});
	}

	registerSignal(callback) {
		this.logger.verbose('Driver:registerSignal(callback)', callback);
		return this.signal.register(callback);
	}

	unregisterSignal() {
		this.logger.verbose('Driver:unregisterSignal()+shouldUnregister', !this.isPairing && this.devices.size === 0);
		if (!this.isPairing && this.devices.size === 0) {
			this.signal.unregister();
			return true;
		}
		return false;
	}

	handleReceivedTrigger(device, data) {
		this.logger.silly('Driver:handleReceivedTrigger(device, data)', device, data);
		if (data.id === device.id) {
			Homey.manager('flow').triggerDevice(
				`${this.config.id}:received`,
				null,
				Object.assign({}, { device: device }, data),
				this.getDevice(device), err => {
					if (err) Homey.error('Trigger error', err);
				}
			);
		}
	}

	onTriggerReceived(callback, args, state) {
		this.logger.silly('Driver:onTriggerReceived(callback, args, state)', callback, args, state);
		callback(null, Object.keys(args).reduce(
			(result, curr) => result && String(args[curr]) === String(state[curr]),
			true
		));
	}

	onActionSend(callback, args) {
		this.logger.silly('Driver:handleReceivedTrigger(callback, args)', callback, args);
		const device = this.getDevice(args.device);
		if (device) {
			this.send(device, args).then(() => callback(null, true)).catch(callback);
		} else {
			callback('Could not find device');
		}
	}

	bitStringToBitArray(bitString) {
		this.logger.silly('Driver:bitStringToBitArray(bitString)', bitString);
		const bitArray = bitString.split('').map(Number);
		if (bitArray.find(isNaN)) {
			const err = new Error(`[Error] Bitstring (${bitString}) contains non-integer values`);
			this.logger.error(err);
			this.emit('error', err);
		}
		return bitArray;
	}

	bitArrayToString(inputBitArray) {
		this.logger.silly('Driver:bitArrayToString(inputBitArray)', inputBitArray);
		const bitArray = inputBitArray.slice(0).map(Number);
		if (bitArray.find(isNaN)) {
			const err = new Error(`[Error] Bitarray (${inputBitArray}) contains non-integer values`);
			this.logger.error(err);
			this.emit('error', err);
		}
		return bitArray.join('');
	}

	bitArrayToNumber(inputBitArray) {
		this.logger.silly('Driver:bitArrayToNumber(inputBitArray)', inputBitArray);
		const bitArray = inputBitArray.slice(0).map(Number);
		if (bitArray.find(nr => nr !== 0 && nr !== 1)) {
			const err = new Error(`[Error] Bitarray (${inputBitArray}) contains non-binary values`);
			this.logger.error(err);
			this.emit('error', err);
		}
		return parseInt(bitArray.join(''), 2);
	}

	numberToBitArray(inputNumber, length) {
		this.logger.silly('Driver:numberToBitArray(inputNumber, length)', inputNumber, length);
		const number = Number(inputNumber);
		if (isNaN(number) || number % 1 !== 0) {
			const err = new Error(`[Error] inputNumber (${inputNumber}) is a non-integer value`);
			this.logger.error(err);
			this.emit('error', err);
		}
		return '0'
			.repeat(length)
			.concat(number.toString(2))
			.substr(length * -1)
			.split('')
			.map(Number);
	}

	bitArrayXOR(arrayA, arrayB) {
		this.logger.silly('Driver:bitArrayXOR(arrayA, arrayB)', arrayA, arrayB);
		if (arrayA.length !== arrayB.length) {
			const err = new Error(`[Error] bitarrays [${arrayA}] and [${arrayB}] do not have the same length`);
			this.logger.error(err);
			this.emit('error', err);
		}
		if (arrayA.find(nr => nr !== 0 && nr !== 1) || arrayB.find(nr => nr !== 0 && nr !== 1)) {
			const err = new Error(`[Error] Bitarray [${arrayA}] and/or [${arrayB}] contain non-binary values`);
			this.logger.error(err);
			this.emit('error', err);
		}
		return arrayA.map((val, index) => val !== arrayB[index] ? 1 : 0);
	}

	generateRandomBitString(length) {
		return new Array(length)
			.fill(null)
			.map(() => Math.round(Math.random()))
			.join('');
	}

	getSettings(device) {
		this.logger.silly('Driver:getSettings(device)', device);
		const id = this.getDeviceId(device);
		if (this.pairingDevice && this.pairingDevice.data && this.pairingDevice.data.id === id) {
			return this.pairingDevice.settings || {};
		} else if (id) {
			return this.settings.get(id) || {};
		}
		return {};
	}

	setSettings(device, settings, callback) {
		this.logger.silly('Driver:setSettings(device, settings, callback)', device, settings, callback);
		const id = this.getDeviceId(device);
		if (this.pairingDevice && this.pairingDevice.data && this.pairingDevice.data.id === id) {
			const newSettings = Object.assign(this.pairingDevice.settings = this.pairingDevice.settings || {}, settings);
			if (callback) {
				callback(null, newSettings);
			}
		} else if (id) {
			this.setSettingsExt(device, Object.assign(this.settings.get(id) || {}, settings), callback);
		}
		this.settings.set(id, Object.assign(this.settings.get(id) || {}, settings));
		this.logger.setExtra(
			{ [this.config.id]: Object.assign(this.driverState, { settings: Array.from(this.settings.entries()) }) }
		);
	}

	updateSettings(device, settings, oldSettings, changedKeys, callback) {
		this.logger.silly(
			'Driver:updateSettings(device, settings, oldSettings, changedKeys, callback)',
			device, settings, oldSettings, changedKeys, callback
		);
		if (!settings) {
			if (callback) {
				callback(new Error(__('433_generator.error.emptySettings')));
			}
		} else {
			const id = this.getDeviceId(device);
			this.settings.set(id, Object.assign({}, this.settings.get(id) || {}, settings || {}));
			if (callback) {
				callback(null, true);
			}
		}
		this.logger.setExtra(
			{ [this.config.id]: Object.assign(this.driverState, { settings: Array.from(this.settings.entries()) }) }
		);
	}

	getExports() {
		this.logger.silly('Driver:getExports()');
		return {
			init: this.init.bind(this),
			pair: this.pair.bind(this),
			deleted: this.deleted.bind(this),
			added: this.add.bind(this),
			settings: this.updateSettings.bind(this),
			driver: this,
		};
	}
};
