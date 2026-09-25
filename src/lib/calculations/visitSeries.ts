import type { FormulaDraftRun } from '$api/service';
import type { SpotPointStats } from '$lib/charts/spotMarkers';

/** One line of the visit plot: an input the visits hold, a step, or an output. */
export interface VisitSeries {
	key: string;
	label: string;
	role: 'input' | 'step' | 'output';
	/** The value at each visit, the replicate mean where the visit holds several. */
	values: (number | null)[];
	/** The mean, sd and extremes at each visit, keyed by its time in seconds. */
	stats: Map<number, SpotPointStats>;
}

/**
 * A run's value at one visit as a spot point: a number is itself, a replicate list is its mean
 * with the sample sd (n-1) over the finite members. Null where nothing finite was produced.
 */
export function visitPoint(value: unknown): SpotPointStats | null {
	const members = (Array.isArray(value) ? value : [value]).filter(
		(v): v is number => typeof v === 'number' && Number.isFinite(v),
	);
	if (members.length === 0) return null;
	const n = members.length;
	const mean = members.reduce((a, b) => a + b, 0) / n;
	const stdev =
		n >= 2 ? Math.sqrt(members.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null;
	return { mean, stdev, n, min: Math.min(...members), max: Math.max(...members) };
}

/**
 * The set over a site's visits, a series per input, step and output, from one run per visit.
 * `times` are the visits' instants in seconds, in the order the runs answer them. Inputs come in
 * the order the runs first report them; a run that ended without results leaves a gap.
 */
export function visitSeries(
	times: number[],
	runs: FormulaDraftRun[],
	formulas: Array<{ code: string; name?: string; intermediate?: boolean }>,
): VisitSeries[] {
	const inputs: string[] = [];
	for (const run of runs) {
		for (const input of run.event_inputs ?? []) {
			if (!inputs.includes(input.param)) inputs.push(input.param);
		}
	}
	const series = (
		key: string,
		label: string,
		role: VisitSeries['role'],
		read: (run: FormulaDraftRun) => unknown,
	): VisitSeries => {
		const stats = new Map<number, SpotPointStats>();
		const values = runs.map((run, i) => {
			const point = run.ran ? visitPoint(read(run)) : null;
			if (point) stats.set(times[i], point);
			return point?.mean ?? null;
		});
		return { key, label, role, values, stats };
	};
	return [
		...inputs.map((param) =>
			series(param, param, 'input', (run) =>
				run.event_inputs?.find((e) => e.param === param)?.value,
			),
		),
		...formulas
			.filter((f) => f.code.trim())
			.map((f) =>
				series(f.code, f.name?.trim() || f.code, f.intermediate ? 'step' : 'output', (run) =>
					run.results?.[f.code],
				),
			),
	];
}
