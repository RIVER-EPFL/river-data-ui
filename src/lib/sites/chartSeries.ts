import type { ChartData } from '$components/charts/ParameterChart.svelte';
import { groupBySlot } from '$lib/charts/sensorSplit';
import { spotPointStats, type SpotPointStats } from '$lib/charts/spotMarkers';
import type {
	AggregatesParameter,
	AggregatesResponse,
	ReadingsResponse,
	SampleReplicate,
	SampleStat,
} from '$lib/api/types';
import type { Annotation } from '$api/crud';
import { originLabel } from '$lib/origin';

/// A site chart's series, assembled from what the readings, aggregates and annotation fetches
/// returned. Every function here is of its arguments alone.

export function mean(vals: (number | null)[]): number | null {
	const nums = vals.filter((v): v is number => v != null);
	if (nums.length === 0) return null;
	return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** The sample standard deviation (n-1), which is what the API serves. */
export function stddev(vals: (number | null)[]): number | null {
	const nums = vals.filter((v): v is number => v != null);
	if (nums.length < 2) return null;
	const m = nums.reduce((a, b) => a + b, 0) / nums.length;
	const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
	return Math.sqrt(variance);
}

export function min(vals: (number | null)[]): number | null {
	const nums = vals.filter((v): v is number => v != null);
	return nums.length > 0 ? Math.min(...nums) : null;
}

export function max(vals: (number | null)[]): number | null {
	const nums = vals.filter((v): v is number => v != null);
	return nums.length > 0 ? Math.max(...nums) : null;
}

export function nullPct(vals: (number | null)[]): number {
	if (vals.length === 0) return 0;
	return (vals.filter((v) => v == null).length / vals.length) * 100;
}

/** Where a series came from, for the tooltip's origin line. */
export function originLabelOf(origins: { source_system: string }[] | undefined): string {
	if (!origins?.length) return '';
	return [...new Set(origins.map((o) => originLabel(o.source_system)))].join(' + ');
}

// A sample may carry different curves, which is reported rather than reduced to the first one.
export interface SampleCurve {
	curveId: string | null;
	mixed: boolean;
	replicates: SampleReplicate[];
}

export function sampleCurve(stat: SampleStat): SampleCurve {
	const replicates = stat.replicates ?? [];
	const ids = new Set(replicates.map((r) => r.standard_curve_id ?? null));
	if (ids.size > 1) return { curveId: null, mixed: true, replicates };
	return { curveId: [...ids][0] ?? null, mixed: false, replicates };
}

export interface ContinuousSeries {
	map: Map<string, ChartData>;
	/** Per-slot extra lines under `split_by_sensor`, and the label of the line the chart draws. */
	splits: Map<string, Array<{ label: string; values: (number | null)[] }>>;
	firsts: Map<string, string>;
}

/**
 * The continuous arm. `raw` carries one series per slot; an aggregate read splits by instrument,
 * where every entry for one slot shares the slot's id, so the first is the chart's own line and
 * the rest ride beside it.
 */
export function continuousSeries(
	result: ReadingsResponse | AggregatesResponse | null,
	resolution: string,
	splitBySensor: boolean,
	sensorSeriesLabel: (sensorId: string | null | undefined) => string,
): ContinuousSeries {
	const map = new Map<string, ChartData>();
	const splits = new Map<string, Array<{ label: string; values: (number | null)[] }>>();
	const firsts = new Map<string, string>();
	if (!result?.times?.length) return { map, splits, firsts };

	const times = result.times.map((t) => new Date(t).getTime() / 1000);
	if (resolution === 'raw') {
		for (const p of (result as ReadingsResponse).parameters ?? []) {
			map.set(p.id, {
				times,
				values: p.values,
				flags: p.flagged ?? null,
				flagReasons: p.flag_reasons ?? null,
				unverified: p.unverified ?? null,
			});
		}
		return { map, splits, firsts };
	}

	const slots = groupBySlot(
		((result as AggregatesResponse).parameters ?? []) as AggregatesParameter[],
		sensorSeriesLabel,
	);
	for (const [id, slot] of slots) {
		const p = slot.primary;
		const flags = p.flagged_count ? p.flagged_count.map((n) => n > 0) : null;
		map.set(id, { times, values: p.avg, mins: p.min, maxs: p.max, flags });
		if (splitBySensor) {
			splits.set(id, slot.extras);
			firsts.set(id, slot.primaryLabel);
		}
	}
	return { map, splits, firsts };
}

export interface SpotSeries {
	map: Map<string, ChartData>;
	stats: Map<string, Map<number, SpotPointStats>>;
	curves: Map<string, SampleCurve>;
	withdrawnCounts: Map<string, number>;
	/** Every curve reference the payload named, for the reference cache to resolve in one call. */
	calibrationIds: (string | null)[];
	standardCurveIds: (string | null)[];
}

/**
 * The spot arm, which arrives as sample means with per-point statistics and replicates inline.
 * A curve reference is coerced to `null` rather than left undefined: a consumer reads undefined as
 * "the fetch did not ask for curves" and renders no provenance at all, and this fetch does ask.
 */
export function spotSeries(spotResult: ReadingsResponse | null): SpotSeries {
	const map = new Map<string, ChartData>();
	const stats = new Map<string, Map<number, SpotPointStats>>();
	const curves = new Map<string, SampleCurve>();
	const calibrationIds: (string | null)[] = [];
	const standardCurveIds: (string | null)[] = [];
	const withdrawnCounts = new Map<string, number>();
	if (!spotResult?.times?.length) {
		return { map, stats, curves, withdrawnCounts, calibrationIds, standardCurveIds };
	}

	const times = spotResult.times.map((t) => new Date(t).getTime() / 1000);
	const ms = spotResult.times.map((t) => new Date(t).getTime());
	for (const p of spotResult.parameters ?? []) {
		map.set(p.id, {
			times,
			values: p.values,
			flags: p.flagged ?? null,
			flagReasons: p.flag_reasons ?? null,
			unverified: p.unverified ?? null,
		});
		if (!p.parameter_id) continue;
		const inner = stats.get(p.parameter_id) ?? new Map<number, SpotPointStats>();
		ms.forEach((at, i) => {
			const s = p.samples?.[i] ?? null;
			const value = s?.mean ?? p.values[i];
			if (value == null) return;
			const calibrationId = p.calibration_ids?.[i] ?? null;
			const standardCurveId = p.standard_curve_ids?.[i] ?? null;
			calibrationIds.push(calibrationId);
			standardCurveIds.push(standardCurveId);
			inner.set(
				at,
				spotPointStats(s, {
					mean: value,
					withdrawn: p.withdrawn?.[i] === true,
					calibrationId,
					standardCurveId,
				}),
			);
			if (s) {
				curves.set(s.sample_id, sampleCurve(s));
				for (const rep of s.replicates ?? []) {
					calibrationIds.push(rep.calibration_id ?? null);
					standardCurveIds.push(rep.standard_curve_id ?? null);
				}
			}
		});
		if (inner.size > 0) stats.set(p.parameter_id, inner);
		if ((p.withdrawn_count ?? 0) > 0) withdrawnCounts.set(p.parameter_id, p.withdrawn_count ?? 0);
	}
	return { map, stats, curves, withdrawnCounts, calibrationIds, standardCurveIds };
}

/** Series origin labels from whichever fetch carried them; aggregates never do. */
export function mergeOriginLabels(
	existing: Map<string, string>,
	sources: Array<ReadingsResponse | AggregatesResponse | null>,
): Map<string, string> {
	const labels = new Map(existing);
	for (const source of sources) {
		if (!source || !('parameters' in source)) continue;
		for (const p of (source as ReadingsResponse).parameters ?? []) {
			const label = originLabelOf(p.origins);
			if (label) labels.set(p.id, label);
		}
	}
	return labels;
}

export function annotationsByParameter(anns: Annotation[]): Map<string, Annotation[]> {
	const map = new Map<string, Annotation[]>();
	for (const a of anns) {
		const list = map.get(a.parameter_id) ?? [];
		list.push(a);
		map.set(a.parameter_id, list);
	}
	return map;
}
