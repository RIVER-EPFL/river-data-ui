import { SvelteMap } from 'svelte/reactivity';
import { api, type SensorCalibration, type StandardCurve } from '$api/crud';
import { curveEquation, curveLabel } from '$lib/standardCurves';

/**
 * A reading records two corrections by id: the base calibration resolved from the instrument's
 * time windows, and a standard curve picked by hand. Either may be null and neither endpoint
 * returns names, so every view that inspects a value resolves its labels here.
 *
 * A null id means no curve of that kind was applied. That is not the same as a curve that happens
 * to be identity, so the two references are always reported separately and a null renders as
 * "None" rather than being hidden.
 */

const calibrations = new SvelteMap<string, SensorCalibration | null>();
const curves = new SvelteMap<string, StandardCurve | null>();
const inflight = new Set<string>();

async function fetchOne<T>(
	id: string,
	cache: SvelteMap<string, T | null>,
	get: (id: string) => Promise<T>,
): Promise<void> {
	if (cache.has(id) || inflight.has(id)) return;
	inflight.add(id);
	try {
		cache.set(id, await get(id));
	} catch {
		// A row the caller cannot read (project scoping) or one that has since gone stays an id.
		cache.set(id, null);
	} finally {
		inflight.delete(id);
	}
}

function distinct(ids: Iterable<string | null | undefined>): string[] {
	const out = new Set<string>();
	for (const id of ids) if (id) out.add(id);
	return [...out];
}

export const curveRefs = {
	ensureCalibrations(ids: Iterable<string | null | undefined>): void {
		for (const id of distinct(ids)) void fetchOne(id, calibrations, api.sensorCalibrations.get);
	},

	ensureStandardCurves(ids: Iterable<string | null | undefined>): void {
		for (const id of distinct(ids)) void fetchOne(id, curves, api.standardCurves.get);
	},

	standardCurve(id: string | null | undefined): StandardCurve | null {
		return id ? (curves.get(id) ?? null) : null;
	},

	calibrationLabel(id: string | null | undefined): string {
		if (!id) return 'None';
		const cal = calibrations.get(id);
		if (!cal) return `Calibration ${id.slice(0, 8)}`;
		return cal.name ?? curveEquation(cal);
	},

	standardCurveLabel(id: string | null | undefined): string {
		if (!id) return 'None';
		return curveLabel(curves.get(id) ?? { id, name: null });
	},

	/** Equation of a resolved standard curve, for tooltips that have room for it. */
	standardCurveEquation(id: string | null | undefined): string | null {
		const curve = id ? curves.get(id) : null;
		return curve ? curveEquation(curve) : null;
	},

	/** The instrument a curve belongs to, for deep links into its Standard curves tab. */
	standardCurveSensorId(id: string | null | undefined): string | null {
		return (id ? curves.get(id)?.sensor_id : null) ?? null;
	},
};
