import { describe, expect, it } from 'vitest';
import { blankParam, visitBinding, withVisitBinding } from './manifest';

function manifest() {
	return {
		params: [
			{ ...blankParam(), name: 'x', kind: 'number' },
			{ ...blankParam(), name: 'doc', kind: 'replicates' },
		],
		event_inputs: [],
	};
}

describe('a param bound to what a visit holds', () => {
	it('binds a scalar through event_inputs and a replicates param through its own code', () => {
		let m = withVisitBinding(manifest(), 'x', 'WTW_Temp');
		m = withVisitBinding(m, 'doc', 'DOC');
		expect(m.event_inputs).toEqual([{ param: 'x', parameter_code: 'WTW_Temp' }]);
		expect(m.params.find((p) => p.name === 'doc')?.parameter_code).toBe('DOC');
		expect(visitBinding(m, 'x')).toBe('WTW_Temp');
		expect(visitBinding(m, 'doc')).toBe('DOC');
	});

	it('replaces a scalar binding rather than adding a second, and keeps its alignment', () => {
		const held = {
			...manifest(),
			event_inputs: [{ param: 'x', parameter_code: 'A', alignment: 'hold' }],
		};
		const m = withVisitBinding(held, 'x', 'B');
		expect(m.event_inputs).toEqual([{ param: 'x', parameter_code: 'B', alignment: 'hold' }]);
	});

	it('unbinds on an empty code', () => {
		const m = withVisitBinding(withVisitBinding(manifest(), 'x', 'A'), 'x', ' ');
		expect(m.event_inputs).toEqual([]);
		expect(visitBinding(m, 'x')).toBe('');
	});
});
