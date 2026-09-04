import type { AggregatesParameter } from '$lib/api/types';

/// One slot's series after a `split_by_sensor` read: the line the chart draws itself, the further
/// lines that ride beside it, and what to call the first one.
export interface SlotSeries {
	primary: AggregatesParameter;
	extras: Array<{ label: string; values: (number | null)[] }>;
	primaryLabel: string;
}

/**
 * Group a split aggregates response by slot. Every entry for one slot shares the slot's `id` and
 * differs only in `sensor_id`, so the first is the chart's own line and the rest are extras. The
 * order the server returns is kept: it is `ORDER BY bucket, parameter_id, sensor_id`, so a series
 * does not change colour between two reads of the same window.
 */
export function groupBySlot(
	parameters: AggregatesParameter[],
	label: (sensorId: string | null | undefined) => string,
): Map<string, SlotSeries> {
	const slots = new Map<string, SlotSeries>();
	for (const p of parameters) {
		const slot = slots.get(p.id);
		if (slot) {
			slot.extras.push({ label: label(p.sensor_id), values: p.avg });
		} else {
			slots.set(p.id, { primary: p, extras: [], primaryLabel: label(p.sensor_id) });
		}
	}
	return slots;
}
