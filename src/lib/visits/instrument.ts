import { curveCountLabel } from '$lib/standardCurves';

/**
 * What a cell's declared instrument says about its curves, and where they are: an instrument with
 * no curve corrects nothing, so the declaration has to say so where it is made (Q58). Null for a
 * cell that declares none.
 */
export function instrumentCurves(
	sensorId: string | null | undefined,
	count: number | null,
): { label: string; href: string } | null {
	if (!sensorId) return null;
	return { label: curveCountLabel(count), href: `/sensors/${sensorId}?tab=curves` };
}
