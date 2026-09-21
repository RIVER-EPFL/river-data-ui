import { describe, expect, it } from 'vitest';

import type { ConsumedInput, ConsumedMember } from '$api/service';
import {
	anyChanged,
	consumedText,
	markTip,
	markVariant,
	memberHref,
	orderedInputs,
} from './consumed';

function member(point: ConsumedMember['point']): ConsumedMember {
	return {
		stream_id: 's1',
		time: '2026-07-14T09:00:00Z',
		replicate_index: 0,
		revision: 4,
		value: 10,
		current_revision: 4,
		current_value: 10,
		state: 'unchanged',
		point,
	};
}

function input(variable: string, kind: string, state = 'unchanged'): ConsumedInput {
	return { variable, kind, revision: null, current_revision: null, value: 1, state };
}

describe('consumed input links', () => {
	it('opens the slot record of the reading that was read', () => {
		const href = memberHref(
			'/app',
			member({
				site_id: 'site-1',
				site_parameter_id: 'sp-1',
				time: '2026-07-14T09:00:00Z',
				measurement_type: 'spot',
			}),
		);
		expect(href).toBe('/app/sites/site-1?point=sp-1&t=2026-07-14T09%3A00%3A00.000Z&mt=spot');
	});

	it('gives an unpaired key no link', () => {
		expect(memberHref('/app', member(undefined))).toBeNull();
	});

	it('reads a cadence it does not know as the continuous arm', () => {
		const href = memberHref(
			'',
			member({
				site_id: 'site-1',
				site_parameter_id: 'sp-1',
				time: '2026-07-14T09:00:00Z',
				measurement_type: 'derived',
			}),
		);
		expect(href).toContain('mt=continuous');
	});
});

describe('consumed marks', () => {
	it('warns on a moved source and says nothing of one it cannot compare', () => {
		expect(markVariant('changed')).toBe('warning');
		expect(markVariant('unchanged')).toBe('ok');
		expect(markVariant('unknown')).toBe('muted');
		expect(markTip('unknown')).toContain('no comparison');
	});

	it('reports a set with one moved input as changed', () => {
		expect(anyChanged([input('a', 'reading'), input('b', 'reading', 'changed')])).toBe(true);
		expect(anyChanged([input('a', 'reading', 'unknown')])).toBe(false);
	});
});

describe('consumed values', () => {
	it('prints a replicate list in order and a curve as its equation terms', () => {
		expect(consumedText([120, null, 122])).toBe('120, -, 122');
		expect(consumedText({ slope: 2, intercept: 0.5 })).toBe('slope 2, intercept 0.5');
		expect(consumedText(null)).toBe('-');
	});
});

describe('consumed ordering', () => {
	it('puts the pinned steps after the values they were applied to', () => {
		const order = orderedInputs([
			input('pco2_step', 'step'),
			input('temp', 'reading'),
			input('alkalinity', 'mean'),
		]).map((c) => c.variable);
		expect(order).toEqual(['alkalinity', 'temp', 'pco2_step']);
	});
});
