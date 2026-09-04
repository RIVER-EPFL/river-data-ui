import { describe, it, expect } from 'vitest';
import { spotWhiskerExtent } from './spotMarkers';
import type { SpotPointStats } from './spotMarkers';

const group: SpotPointStats = { mean: 48.2, stdev: 1, n: 3, min: 41.2, max: 62 };

describe('spotWhiskerExtent', () => {
	it('spans the sd bar alone by default', () => {
		expect(spotWhiskerExtent([group])).toEqual([47.2, 49.2]);
	});

	it('widens to the observed replicates in dot mode, so none is clipped', () => {
		expect(spotWhiskerExtent([group], true)).toEqual([41.2, 62]);
	});
});
