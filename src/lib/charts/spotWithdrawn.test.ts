import { describe, it, expect, vi } from 'vitest';
import { spotMarkersPlugin, type SpotPointStats } from './spotMarkers';
import type uPlot from 'uplot';

/**
 * The retracted instant is drawn as a state, not as an absence. This exercises the draw hook
 * against a stub canvas and asserts the ring goes down: a fully retracted group that silently
 * vanished is the defect.
 */
function drawOnce(stats: Map<number, SpotPointStats>) {
	const calls: string[] = [];
	const ctx = new Proxy(
		{ canvas: {} },
		{
			get(_t, prop: string) {
				if (prop === 'lineWidth' || prop === 'fillStyle' || prop === 'strokeStyle') return '';
				if (prop === 'globalAlpha') return 1;
				return (...args: unknown[]) => {
					calls.push(`${prop}(${args.join(',')})`);
				};
			},
			set() {
				return true;
			},
		}
	) as unknown as CanvasRenderingContext2D;

	const u = {
		data: [[10], [4.2]],
		ctx,
		bbox: { left: 0, top: 0, width: 100, height: 100 },
		valToPos: (v: number) => v,
		pxRatio: 1,
	} as unknown as uPlot;

	const plugin = spotMarkersPlugin(() => [{ seriesIdx: 1, stats }]);
	const draw = plugin.hooks.draw as Array<(u: uPlot) => void>;
	draw[0](u);
	return calls;
}

describe('a retracted spot instant', () => {
	it('is drawn with a ring rather than dropped from the plot', () => {
		const stats = new Map<number, SpotPointStats>([
			[10, { mean: 4.2, stdev: null, n: 2, withdrawn: true }],
		]);
		const calls = drawOnce(stats);
		expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(1);
	});

	it('draws no ring for a group that still stands', () => {
		const stats = new Map<number, SpotPointStats>([
			[10, { mean: 4.2, stdev: 0.3, n: 2 }],
		]);
		const calls = drawOnce(stats);
		expect(calls.filter((c) => c.startsWith('arc(')).length).toBe(0);
	});
});
