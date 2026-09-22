import { describe, expect, it } from 'vitest';

import { visitsExtent, isDraggableExtent } from './visitsExtent';

const at = (collected_at: string) => ({ collected_at });

describe('visitsExtent', () => {
	it('spans the first and the last visit, whatever order they arrive in', () => {
		const extent = visitsExtent([
			at('2026-07-04T08:00:00Z'),
			at('2019-05-02T06:30:00Z'),
			at('2023-01-11T10:00:00Z'),
		]);
		expect(extent).toEqual({
			min: Date.parse('2019-05-02T06:30:00Z'),
			max: Date.parse('2026-07-04T08:00:00Z'),
		});
	});

	it('reports no extent for a site holding no visit', () => {
		expect(visitsExtent([])).toBeNull();
	});

	it('leaves out a visit whose instant does not parse', () => {
		const extent = visitsExtent([at('not a date'), at('2026-07-04T08:00:00Z')]);
		expect(extent).toEqual({
			min: Date.parse('2026-07-04T08:00:00Z'),
			max: Date.parse('2026-07-04T08:00:00Z'),
		});
	});
});

describe('isDraggableExtent', () => {
	it('refuses an extent with nothing to drag across', () => {
		const instant = Date.parse('2026-07-04T08:00:00Z');
		expect(isDraggableExtent(null)).toBe(false);
		expect(isDraggableExtent({ min: instant, max: instant })).toBe(false);
	});

	it('accepts an extent spanning two instants', () => {
		expect(isDraggableExtent({ min: 0, max: 1 })).toBe(true);
	});
});
