'use strict';

const Driver = require('./lib/driver');

const uuidGenerator = require('uuid');

module.exports = class Cotech extends Driver {

	constructor(config) {
		super(config);
		this.addressMap = new Map();
		this.uuidMap = new Map();
		this.payloadToStateMap = new Map();
	}

	add(device) {
		if (!(device.addresses && device.addresses.on && device.addresses.on.length && device.addresses.off && device.addresses.off.length)) {
			return this.error('Invalid device object added', device);
		}
		device.addresses.on
			.map(address => Array.isArray(address) ? address.join('') : address)
			.forEach(address =>
				this.payloadToStateMap.has(address) ?
					this.payloadToStateMap.get(address).count++ :
					this.payloadToStateMap.set(address, { state: 1, count: 1 })
			);
		device.addresses.off
			.map(address => Array.isArray(address) ? address.join('') : address)
			.forEach(address =>
				this.payloadToStateMap.has(address) ?
					this.payloadToStateMap.get(address).count++ :
					this.payloadToStateMap.set(address, { state: 0, count: 1 })
			);
		this._setUuidForAddresses(1, device.addresses.on, device.uuid);
		this._setUuidForAddresses(0, device.addresses.off, device.uuid);
		super.add(device);
	}

	deleted(device) {
		device.addresses.on
			.concat(device.addresses.off)
			.map(address => Array.isArray(address) ? address.join('') : address)
			.forEach(address => {
					const entry = this.payloadToStateMap.get(address);
					if (entry) {
						if (entry.count <= 1) {
							this.payloadToStateMap.delete(address);
						} else {
							entry.count--;
						}
					}
				}
			);
		super.deleted(device);
	}

	payloadToData(payload) { // Convert received data to usable variables
		if (payload.length === 32) {
			const address = payload.slice(0, 28);
            let uuid = this._getUuidByAddress(address);

			if (!uuid) {
				if (this.isPairing) {
					if (this.pairingDevice && this.pairingDevice.data && this.pairingDevice.data.addresses
						&& (this.pairingDevice.data.addresses.on.indexOf(this.bitArrayToString(address)) !== -1
						|| this.pairingDevice.data.addresses.off.indexOf(this.bitArrayToString(address)) !== -1)) {
						uuid = this.pairingDevice.data.uuid;
					} else {
						uuid = uuidGenerator.v4();
					}
				} else {
					return null;
				}
			}

			const data = {
				uuid,
				address: this.bitArrayToString(address),
				unit: this.bitArrayToString(payload.slice(28, 32)),
				state: this.parseState(address),
			};
			data.id = `${data.uuid}:${data.unit}`;
			return data;
		}
		return null;
	}

	parseState(payload) {
		payload = Array.isArray(payload) ? payload.join('') : payload;
		payload = payload.slice(0, 28);
		if (this.payloadToStateMap.has(payload)) {
			return this.payloadToStateMap.get(payload).state;
		} else if (this.isPairing && this.pairingDevice && this.pairingDevice.data && this.pairingDevice.data.addresses) {
			if (this.pairingDevice.data.addresses.on && this.pairingDevice.data.addresses.on.indexOf(payload) !== -1) {
				return 1;
			}
			if (this.pairingDevice.data.addresses.off && this.pairingDevice.data.addresses.off.indexOf(payload) !== -1) {
				return 0;
			}
		}
		return -1;
	}

	dataToPayload(data) {
		if (
			data &&
			data.uuid &&
			data.unit && data.unit.length === 4 &&
			(typeof data.state === 'number' || typeof data.state === 'string')
		) {
			const state = Number(data.state);
			let address = (this._getAddressByUuid(data.uuid) || {})[state ? 'on' : 'off'];
			if (!address && this.isPairing && this.pairingDevice && this.pairingDevice.data &&
				this.pairingDevice.data.uuid === data.uuid && this.pairingDevice.data.addresses &&
				this.pairingDevice.data.addresses[state ? 'on' : 'off'].length) {
				address = this.pairingDevice.data.addresses[state ? 'on' : 'off'][0];
			}
			if (address) {
				address = this.bitStringToBitArray(address);
			} else {
				return null;
			}
			const unit = this.bitStringToBitArray(data.unit);
			return address.concat(unit);
		}
		return null;
	}

	_getAddressByUuid(uuid) {
		const addresses = this._getAddressesByUuid(uuid);
		if (!addresses) return null;
		addresses.curIndex = (typeof addresses.curIndex === 'number' ? ++addresses.curIndex : 0) % 4;
		return {
			on: addresses.on[addresses.curIndex % addresses.on.length],
			off: addresses.off[addresses.curIndex % addresses.off.length]
		}
	}

	_getAddressesByUuid(uuid) {
		const addresses = this.uuidMap.get(uuid);
		if (!(addresses && addresses.on && addresses.on.length && addresses.off && addresses.off.length)) return null;
		return addresses;
	}


	_getUuidByAddress(address) {
		return this.addressMap.get(Array.isArray(address) ? this.bitArrayToString(address) : address);
	}

	_setUuidForAddresses(state, addresses, uuid) {
		return addresses.forEach(address => {
			this.addressMap.set(address, uuid);
			const addressObj = (this.uuidMap.get(uuid) || { on: [], off: [] });
			addressObj[state ? 'on' : 'off'].push(address);
			this.uuidMap.set(uuid, addressObj);
		});
	}

	_removeAddressesForUuid(uuid) {
		return addresses.forEach(address => {
			for (const entry of this.addressMap) {
				if (entry[1] === uuid) {
					this.addressMap.remove(entry[0]);
				}
			}
			this.uuidMap.remove(uuid);
		});
	}

	pair(socket) {
		super.pair(socket);
		let listenState = -1;

		socket.on('clear_repetitions', (options, callback) => {
			if (this.pairingDevice && this.pairingDevice.data) {
				this.pairingDevice.data.addresses = {
					on: options.keepState === 'on' ? ((this.pairingDevice.data.addresses || {}).on || []) : [],
					off: options.keepState === 'off' ? ((this.pairingDevice.data.addresses || {}).off || []) : [],
				};
			}
			callback(null, this.pairingDevice);
		});

		socket.on('set_listen_state', (options, callback) => {
			this.logger.info('setting pair listen state to', options.state);
			listenState = options.state;
			callback();
		});

		const frameListener = (frame) => {
			if (this.pairingDevice && this.pairingDevice.data && (listenState === 0 || listenState === 1)) {
				if (!this.pairingDevice.data.addresses) {
					this.pairingDevice.data.addresses = {
						on: [],
						off: [],
					};
				}
				if (this.pairingDevice.data.addresses.on.indexOf(frame.address) === -1
					&& this.pairingDevice.data.addresses.off.indexOf(frame.address) === -1
					&& (this.parseState(frame.address) === -1 || this.parseState(frame.address) === listenState)) {
					this.pairingDevice.data.addresses[listenState ? 'on' : 'off'].push(frame.address);
					socket.emit('device_data_update', this.pairingDevice);
				}
			}
		};

		this.on('frame', frameListener);

		socket.on('disconnect', () => {
			this.removeListener('frame', frameListener);
		});
	}
};
