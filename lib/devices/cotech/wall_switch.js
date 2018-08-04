'use strict';

const _ = require('lodash');
const util = require('homey-rfdriver').util;

module.exports = RFDevice => class WallSwitch extends RFDevice {

	onRFInit() {
		super.onRFInit();
		this.options.buttonCount = this.options.buttonCount || 1;
	}

    matchesData(deviceData) {
	    if(this.getData().addresses && deviceData.address)
	        return _.includes(this.getData().addresses, deviceData.address);

        return super.matchesData(deviceData);
    }

    sendProgramSignal(data = {}) {
        return super.sendProgramSignal({ ...data, state: 1 });
    }

	parseIncomingData(data) {
		if (this.options.buttonCount > 1 && !this.isPairInstance && this.getSetting('rotated') === '180') {
			data.buttonIndex = Math.abs(data.buttonIndex - (this.options.buttonCount - 1));
			data.state = data.state === 0 ? 1 : 0;
		}
		return super.parseIncomingData(data);
	}

    static payloadToData(payload) {
        if (payload.length === 32) {
            return {
                id: util.bitArrayToString(payload),
                address: util.bitArrayToString(payload),
                buttonIndex: WallSwitch.parseButtonIndex(payload),
                state: WallSwitch.parseState(payload),
            };
        }
        return null;
    }

    static dataToPayload(data) {
        if (
            data &&
            data.addresses &&
            (typeof data.state === 'number' || typeof data.state === 'string')
        ) {
            const state = Number(data.state);
            const buttonIndex = data.buttonIndex ? Number(data.buttonIndex) : 0;

            for(let i = 0; i < data.addresses.length; i++) {
                let address = data.addresses[i];
                if(buttonIndex === WallSwitch.parseButtonIndex(address) && state === WallSwitch.parseState(address))
                    return util.bitStringToBitArray(address);
            }
        }

        return null;
    }

    static parseButtonIndex(payload) {
        payload = Array.isArray(payload) ? payload.join('') : payload;
        const unit = payload.slice(28, 32);
        switch(unit)
        {
            case '0011':
                return 0;
            case '0101':
                return 1;
            default:
                return -1;
        }
    }

    static parseState(payload) {
        payload = Array.isArray(payload) ? payload.join('') : payload;
        const state = payload.slice(16, 24);

        switch (state) {
            case '01101000': //buttonIndex 0 - off
            case '10011000': //buttonIndex 0 - off
            case '01101111': //buttonIndex 1 - off
            case '11110110': //buttonIndex 1 - off
                return 0;
            case '01101101': //buttonIndex 0 - on
            case '11111010': //buttonIndex 0 - on
            case '10000111': //buttonIndex 1 - on
            case '11111100': //buttonIndex 1 - on
                return 1;
            default:
                return -1;
        }
    }
};
