export const tokens = {
	brand: {
		primary: '#1F4E79',
		primaryDk: '#16314A',
		accent: '#C77700',
		accentDk: '#9E5F00',
		surface: '#FFFFFF',
		bg: '#F7F8FA',
		divider: '#E2E5EA',
		text: '#1B2330',
		textMuted: '#5A6472',
	},
	severity: {
		ok: { main: '#2E7D32', soft: 'rgba(46,125,50,0.10)', border: 'rgba(46,125,50,0.45)' },
		warning: { main: '#CA8A04', soft: 'rgba(202,138,4,0.16)', border: 'rgba(202,138,4,0.65)' },
		alarm: { main: '#C62828', soft: 'rgba(198,40,40,0.12)', border: 'rgba(198,40,40,0.65)' },
		unknown: { main: '#90A4AE', soft: 'rgba(144,164,174,0.10)', border: 'rgba(144,164,174,0.40)' },
	},
	dataViz: ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9', '#E69F00', '#F0E442', '#000000'],
	markers: {
		grabSample: { fill: '#FFB74D', stroke: '#E65100' },
		flagged: { stroke: '#D32F2F' },
		annotationDefault: 'rgba(158,158,158,0.18)',
	},
	font: {
		body: '"Inter","Roboto","Helvetica Neue",system-ui,sans-serif',
		mono: '"JetBrains Mono","SF Mono","Roboto Mono","Menlo",monospace',
	},
	density: { rowY: 6, cardGap: 12, sectionGap: 24, pageGutter: 16 },
};
