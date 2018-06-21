'use strict';
/* eslint-disable */
const config = {
	class: 'other',
	pair: {
		viewOrder: ['generic_imitate',
			'copy_repetitions_on',
			'copy_repetitions_off',
			'generic_test_remote',
			'generic_done'
		],
		views: [{
				template: '../lib/pair/imitate.html',
				options: {
					title: 'deviceClasses.generic_remote.views.generic_imitate.title',
					body: 'deviceClasses.generic_remote.views.generic_imitate.body',
					prepend: [],
					append: [],
					svg: '../../433_generator/assets/366364_wallswitch/pair.svg',
					svgWidth: '80vw',
					svgHeight: '70vh',
					initWithDeviceData: false,
					previous: true,
					next: false
				},
				prepend: ['../../assets/433_generator/css/styles.css',
					'../../assets/433_generator/css/svg.css',
					'../../assets/433_generator/js/svghighlighter.js'
				],
				append: [],
				id: 'generic_imitate'
			},
            {
                template: '../../433_generator/views/copy_repetitions.html',
                options: {
                    title: 'views.copy_repetitions_on.title',
                    body: 'views.copy_repetitions_on.body',
                    hideBar: 'off',
                    previous: true,
                    next: false,
                    prepend: '',
                    append: ''
                },
                prepend: [],
                append: [],
                id: 'copy_repetitions_on'
            },
            {
                options: {
                    title: 'views.copy_repetitions_off.title',
                    body: 'views.copy_repetitions_off.body',
                    hideBar: 'on',
                    previous: true,
                    next: false,
                    prepend: '',
                    append: ''
                },
                prepend: [],
                template: '../../433_generator/views/copy_repetitions.html',
                append: [],
                id: 'copy_repetitions_off'
            },

			{
				template: '../lib/pair/test_remote.html',
				options: {
					svg: '../../433_generator/assets/366364_wallswitch/test.svg',
					prepend: [],
					append: [],
					title: 'views.generic_test_remote.title',
					body: 'views.generic_test_remote.body',
					svgWidth: '80vw',
					svgHeight: '70vh',
					initWithDeviceData: false,
					previous: true,
					next: true
				},
				prepend: ['../../assets/433_generator/css/styles.css',
					'../../assets/433_generator/css/svg.css',
					'../../assets/433_generator/js/svghighlighter.js'
				],
				append: [],
				id: 'generic_test_remote'
			},
			{
				template: '../lib/pair/done.html',
				options: {
					title: 'views.generic_done.title',
					prepend: '',
					append: ''
				},
				prepend: [],
				append: [],
				id: 'generic_done'
			}
		]
	},
	images: {
		small: './assets/images/small.jpg',
		large: './assets/images/large.jpg'
	},
	id: '366364_wallswitch',
	driver: '../remote',
	signal: 'cotech',
	triggers: [{
		id: '366364_wallswitch:received',
		title: '433_generator.generic.button_pressed',
		args: [{
				name: 'unit',
				type: 'dropdown',
            	values: [{
					id: '0101',
					label: '433_generator.generic.buttons.A'
				},
                {
                    id: '0011',
                    label: '433_generator.generic.buttons.B'
                }
			]
			},
			{
				name: 'state',
				type: 'dropdown',
				values: [{
						id: '1',
						label: '433_generator.generic.on'
					},
					{
						id: '0',
						label: '433_generator.generic.off'
					}
				]
			},
			{
				name: 'device',
				type: 'device',
				filter: 'driver_id=366364_wallswitch'
			}
		]
	}],
	name: 'devices.366364_wallswitch.name',
	icon: '../../433_generator/assets/366364_wallswitch/icon.svg'
};
const Driver = require(config.driver);
const driver = new Driver(config);
module.exports = Object.assign(
  {},
	driver.getExports(), 
	{ init: (devices, callback) => driver.init(module.exports, devices, callback) }
);
