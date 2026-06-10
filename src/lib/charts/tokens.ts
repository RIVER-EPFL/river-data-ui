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
		warning: { main: '#CA8A04', soft: 'rgba(202,138,4,0.16)', border: 'rgba(202,138,4,0.65)', text: '#3A2A00' },
		alarm: { main: '#C62828', soft: 'rgba(198,40,40,0.12)', border: 'rgba(198,40,40,0.65)' },
		unknown: { main: '#90A4AE', soft: 'rgba(144,164,174,0.10)', border: 'rgba(144,164,174,0.40)' },
	},
	dataViz: ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#56B4E9', '#E69F00', '#F0E442', '#000000'],
	markers: {
		grabSample: { fill: '#FFB74D', stroke: '#E65100' },
		flagged: { stroke: '#D32F2F' },
		annotationDefault: 'rgba(158,158,158,0.18)',
	},
	chart: {
		grid: '#EAECEF',
		tooltipBg: 'rgba(20,30,50,0.92)',
		tooltipText: '#FFFFFF',
		minMaxBand: 'rgba(31,78,121,0.12)',
	},
	annotationCategories: {
		maintenance: 'rgba(0,114,178,0.18)',
		quality_issue: 'rgba(213,94,0,0.18)',
		environmental: 'rgba(0,158,115,0.18)',
		other: 'rgba(160,160,160,0.18)',
	},
	slider: {
		historyTrack: 'rgba(90,100,114,0.25)',
		weekTrack: 'rgba(31,78,121,0.30)',
		todayTrack: 'rgba(46,125,50,0.30)',
	},
	font: {
		body: '"Inter","Roboto","Helvetica Neue",system-ui,sans-serif',
		mono: '"JetBrains Mono","SF Mono","Roboto Mono","Menlo",monospace',
	},
	density: { rowY: 6, cardGap: 12, sectionGap: 24, pageGutter: 16 },
};

/** '#RRGGBB' → 'rgba(r,g,b,alpha)' for canvas/inline-style contexts. */
export function withAlpha(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}
