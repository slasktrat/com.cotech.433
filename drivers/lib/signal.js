'use strict';

const EventEmitter = require('events').EventEmitter;
const SignalManager = Homey.wireless('433').Signal;

const signals = new Map();
const registerLock = new Map();
const registerPromises = new Map();
const unRegisterPromises = new Map();

module.exports = class Signal extends EventEmitter {
	constructor(signalKey, parser, debounceTime, logger) {
		super();
		this.logger = logger || {
				log: (() => null),
				silly: (() => null),
				debug: (() => null),
				verbose: (() => null),
				info: (() => null),
				warn: (() => null),
				error: (() => null),
			};
		this.logger.silly(
			'Signal:constructor(signalKey, parser, debounceTime, logger)',
			signalKey, parser, debounceTime, logger
		);
		this.payloadParser = parser || (payload => ({ payload: SignalManager.bitArrayToString(payload) }));
		this.debounceTimeout = Number(debounceTime) || 500;
		this.signalKey = signalKey;

		if (!signals.has(signalKey)) {
			const signal = new SignalManager(signalKey);

			signal.setMaxListeners(100);

			signal.debouncers = new Map();

			signals.set(signalKey, signal);
			registerLock.set(signalKey, new Set());
		}
		this.signal = signals.get(signalKey);

		// Add debounce event for timeout if there is none
		if (!this.signal.debouncers.has(this.debounceTimeout)) {
			this.signal.debouncers.set(this.debounceTimeout, new Map());
			this.debounceBuffer = this.signal.debouncers.get(this.debounceTimeout);
			this.signal.on('payload', payload => {
				const payloadStr = payload.join('');
				this.logger.debug(`[Signal ${signalKey} ~${this.debounceTimeout}] raw payload:`, payloadStr);
				const debouncer = this.debounce(payload);
				if (debouncer) {
					debouncer.pause();
					this.logger.info(`[Signal ${signalKey} ~${this.debounceTimeout}] payload:`, payloadStr);
					this.signal.emit(`debounce_payload_${this.debounceTimeout}`, payload);
					debouncer.reset();
				}
			});
		} else {
			this.debounceBuffer = this.signal.debouncers.get(this.debounceTimeout);
		}

		this.signal.on(`debounce_payload_${this.debounceTimeout}`, payloadData => { // Start listening to payload event
			if (!this.manualDebounceFlag && !this.signal.manualDebounceFlag) {
				if (true || registerLock.get(this.signalKey).has(this)) {
					// Copy array to prevent mutability issues with multiple drivers
					const payload = Array.from(payloadData).map(Number);
					this.emit('payload', payload);
					// Only continue if the received data is valid
					const data = this.payloadParser(payload);
					if (!data || data.constructor !== Object || !data.id) return;
					this.emit('data', data);
				}
			} else {
				this.logger.verbose(`[Signal ${this.signalKey}] Manually debounced payload:`, payloadData.join(''));
			}
		});
		this.signal.on('payload_send', this.emit.bind(this, 'payload_send'));
	}

	register(callback, key) {
		this.logger.silly('Signal:register(callback, key)', callback, key);
		callback = typeof callback === 'function' ? callback : (() => null);
		if (registerLock.get(this.signalKey).size === 0) {
			this.logger.info(`[Signal ${this.signalKey}] registered signal`);
			registerLock.get(this.signalKey).add(key || this);

			registerPromises.set(this.signalKey, new Promise(resolve => {
				(unRegisterPromises.get(this.signalKey) || Promise.resolve()).then(() => {
					this.signal.register(err => { // Register signal
						// Log errors but other than that just ignore them
						if (err) this.logger.error(err, { extra: { registerLock, registerPromises } });
						resolve();
					});
				});
			}));
		} else {
			registerLock.get(this.signalKey).add(key || this);
		}

		return registerPromises.get(this.signalKey)
			.then(() => callback(null, true))
			.catch(err => {
				callback(err);
				throw err;
			});
	}

	unregister(key) {
		this.logger.silly('Signal:unregister()');
		if (registerLock.get(this.signalKey).size > 0) {
			registerLock.get(this.signalKey).delete(key || this);
			if (registerLock.get(this.signalKey).size === 0 && !unRegisterPromises.get(this.signalKey)) {
				this.logger.info(`[Signal ${this.signalKey}] unregistered signal`);

				(registerPromises.get(this.signalKey) || Promise.resolve()).then(() => {
					if (registerLock.get(this.signalKey).size === 0) {
						unRegisterPromises.set(this.signalKey, new Promise(resolve =>
							this.signal.unregister(err => {
								// Log errors but other than that just ignore them
								if (err) this.logger.error(err, { extra: { registerLock, registerPromises } });
								unRegisterPromises.delete(this.signalKey);
								resolve();
							})
						));
					}
				});
			}
		}
	}

	manualDebounce(timeout, allListeners) {
		this.logger.silly('Signal:manualDebounce(timeout, allListeners)', timeout, allListeners);
		if (allListeners) {
			this.signal.manualDebounceFlag = true;
			clearTimeout(this.signal.manualDebounceTimeout);
			this.signal.manualDebounceTimeout = setTimeout(() => this.signal.manualDebounceFlag = false, timeout);
		} else {
			this.manualDebounceFlag = true;
			clearTimeout(this.manualDebounceTimeout);
			this.manualDebounceTimeout = setTimeout(() => this.manualDebounceFlag = false, timeout);
		}
	}

	send(payload) {
		this.logger.silly('Signal:send(payload)', payload);
		let registerLockKey = Math.random();
		while (registerLock.get(this.signalKey).has(registerLockKey)) {
			registerLockKey = Math.random();
		}
		return this.register(null, registerLockKey).then(() => {
			return new Promise((resolve, reject) => {
				const frameBuffer = new Buffer(payload);
				this.signal.tx(frameBuffer, (err, result) => { // Send the buffer to device
					if (err) { // Print error if there is one
						this.logger.warn(`[Signal ${this.signalKey}] sending payload failed:`, err);
						reject(err);
					} else {
						this.logger.info(`[Signal ${this.signalKey}] send payload:`, payload.join(''));
						this.signal.emit('payload_send', payload);
						resolve(result);
					}
				});
			});
		}).then(() => this.unregister(registerLockKey))
			.catch(err => {
				this.unregister(registerLockKey);
				this.logger.error(err, { extra: { registerLock, registerPromises } });
				this.emit('error', err);
				throw err;
			});
	}

	pauseDebouncers() {
		this.logger.silly('Signal:pauseDebouncers()');
		this.signal.debouncers.forEach(debounceBuffer => {
			debounceBuffer.forEach(debouncer => {
				debouncer.pause();
			});
		});
	}

	resumeDebouncers() {
		this.logger.silly('Signal:resumeDebouncers()');
		this.signal.debouncers.forEach(debounceBuffer => {
			debounceBuffer.forEach(debouncer => {
				debouncer.resume();
			});
		});
	}

	tx(payload, callback) {
		this.logger.silly('Signal:tx(payload, callback)', payload, callback);
		callback = callback || (() => null);
		const frameBuffer = new Buffer(payload);
		this.signal.tx(frameBuffer, callback);
	}

	debounce(payload) {
		this.logger.silly('Signal:debounce(payload)', payload);
		if (this.debounceTimeout <= 0) return payload;

		const payloadString = payload.join('');
		if (!this.debounceBuffer.has(payloadString)) {
			const debouncer = new Debouncer(this.debounceTimeout, () => this.debounceBuffer.delete(payloadString));
			this.debounceBuffer.set(
				payloadString,
				debouncer
			);
			return debouncer;
		}
		const debouncer = this.debounceBuffer.get(payloadString);
		if (debouncer.state === Debouncer.FINISHED) {
			debouncer.reset();
			return debouncer;
		}

		if (debouncer.state !== Debouncer.PAUSED) {
			debouncer.reset();
		}
		return null;
	}
};

class Debouncer {
	constructor(time, idleFn, idleTime) {
		this.origTime = time;
		this.idle = false;
		this.idleFn = idleFn || (() => null);
		this.idleTime = isNaN(idleTime) ? 10000 : Number(idleTime);

		this._init();
	}

	_init() {
		this.time = this.origTime;
		this.state = Debouncer.INITED;
		this.start();
	}

	_setTimeout() {
		this.timeout = setTimeout(() => {
			if (Date.now() - this.startTime < this.time - 10) {
				this.state = Debouncer.REFRESH;
				this.time -= Date.now() - this.startTime;
				this.start();
			} else {
				this.state = Debouncer.FINISHED;
			}
		}, this.time >= 0 ? this.time : 0);
	}

	set state(state) {
		this._state = state;
		if (this._state === Debouncer.FINISHED) {
			if (!this.idle) {
				this.idle = true;
				this.idleTimeout = setTimeout(this.idleFn, this.idleTime);
			}
		} else if (this.idle) {
			clearTimeout(this.idleTimeout);
			this.idle = false;
		}
	}

	get state() {
		return this._state;
	}

	start() {
		if (this.state === Debouncer.INITED || this.state === Debouncer.PAUSED || this.state === Debouncer.REFRESH) {
			this.startTime = Date.now();
			this.state = Debouncer.STARTED;
			this._setTimeout();
		}
	}

	stop() {
		if (this.state === Debouncer.INITED || this.state === Debouncer.PAUSED) {
			clearTimeout(this.timeout);
			this.state = Debouncer.FINISHED;
		}
	}

	pause() {
		if (this.state === Debouncer.STARTED) {
			clearTimeout(this.timeout);
			this.state = Debouncer.PAUSED;
			this.time -= Date.now() - this.startTime;
		}
	}

	resume() {
		if (this.state === Debouncer.PAUSED) {
			this.start();
		}
	}

	reset() {
		if (this.state === Debouncer.FINISHED) {
			this._init();
			this.start();
		} else if (this.state === Debouncer.STARTED) {
			this.time = this.origTime;
			this.startTime = Date.now();
		} else if (this.state === Debouncer.PAUSED) {
			this.time = this.origTime;
			this.start();
		}
	}
}

Debouncer.INITED = -1;
Debouncer.STARTED = 0;
Debouncer.PAUSED = 1;
Debouncer.FINISHED = 2;
Debouncer.REFRESH = 3;
