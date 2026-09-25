import { describe, expect, it } from 'vitest';
import type { FormulaDraftRun } from '$api/service';
import { visitPoint, visitSeries } from './visitSeries';

const run = (
	results: Record<string, unknown>,
	inputs: Array<{ param: string; value: unknown }>,
): FormulaDraftRun =>
	({
		ran: true,
		results,
		event_inputs: inputs.map((i) => ({ ...i, parameter_code: i.param, parameter_id: '' })),
		failure: null,
	}) as FormulaDraftRun;

describe('visitPoint', () => {
	it('reads a replicate list as its mean with the sample sd', () => {
		const point = visitPoint([1, 3, null]);
		expect(point?.mean).toBe(2);
		// sqrt(((1-2)^2 + (3-2)^2) / (2 - 1))
		expect(point?.stdev).toBeCloseTo(Math.SQRT2);
		expect(point?.n).toBe(2);
		expect([point?.min, point?.max]).toEqual([1, 3]);
	});

	it('reads a number as a single measurement and nothing finite as no point', () => {
		expect(visitPoint(4)).toEqual({ mean: 4, stdev: null, n: 1, min: 4, max: 4 });
		expect(visitPoint([null])).toBeNull();
		expect(visitPoint(undefined)).toBeNull();
	});
});

describe('visitSeries', () => {
	it('draws a series per input, step and output, one point per visit', () => {
		const times = [100, 200];
		const runs = [
			run({ S1: 2, CO2: [10, 12] }, [{ param: 'ppm', value: [1, 2] }]),
			run({ S1: 3, CO2: [14, 14] }, [{ param: 'ppm', value: [3, 3] }]),
		];
		const series = visitSeries(times, runs, [
			{ code: 'S1', intermediate: true },
			{ code: 'CO2', name: 'CO2 headspace' },
		]);
		expect(series.map((s) => [s.key, s.role])).toEqual([
			['ppm', 'input'],
			['S1', 'step'],
			['CO2', 'output'],
		]);
		expect(series[2].label).toBe('CO2 headspace');
		expect(series[2].values).toEqual([11, 14]);
		expect(series[2].stats.get(100)?.stdev).toBeCloseTo(Math.SQRT2);
		expect(series[0].values).toEqual([1.5, 3]);
	});

	it('leaves a gap at a visit whose run ended without results', () => {
		const failed = { ran: false, failure: { kind: 'input', message: 'no reading' } } as unknown as FormulaDraftRun;
		const series = visitSeries([1, 2], [run({ S1: 5 }, []), failed], [{ code: 'S1' }]);
		expect(series[0].values).toEqual([5, null]);
		expect(series[0].stats.has(2)).toBe(false);
	});
});
