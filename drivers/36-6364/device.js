'use strict';

const WallSwitchDevice = require('../../lib/devices/cotech/wall_switch.js');

module.exports = RFDevice => class CT366364Device extends WallSwitchDevice(RFDevice) {

    onRFInit() {
        super.onRFInit();
    }

};