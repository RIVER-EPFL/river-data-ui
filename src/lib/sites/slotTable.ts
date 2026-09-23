// The site Parameters table read as one line per slot: its configuration as a single text cell,
// and the search and filters that find a slot among a site's many.

import type { SiteParameter } from '$api/crud';
import type { SlotCalculation, SlotGroup } from '$lib/calculations/siteSlots';

/** A sample interval as the configuration cell words it, e.g. 600 → "10 min". */
export function intervalLabel(seconds: number | null | undefined): string | null {
	if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
	if (seconds % 86400 === 0) return `${seconds / 86400} d`;
	if (seconds % 3600 === 0) return `${seconds / 3600} h`;
	if (seconds % 60 === 0) return `${seconds / 60} min`;
	return `${seconds} s`;
}

/** The slot's configuration on one line, e.g. "mg/L · 10 min · 2 dp · WTW 3430"; empty when none is set. */
export function slotConfiguration(config: {
	units?: string | null;
	intervalSec?: number | null;
	decimals?: number | null;
	instrument?: string | null;
}): string {
	return [
		config.units?.trim() || null,
		intervalLabel(config.intervalSec),
		config.decimals != null ? `${config.decimals} dp` : null,
		config.instrument?.trim() || null,
	]
		.filter(Boolean)
		.join(' · ');
}

export interface SlotFilter {
	query: string;
	calculated: boolean;
	needsReview: boolean;
	cadence: 'high' | 'low' | null;
	/** A group's key: its id, or `ungrouped`. */
	group: string | null;
}

export const NO_FILTER: SlotFilter = {
	query: '',
	calculated: false,
	needsReview: false,
	cadence: null,
	group: null,
};

export function isFiltering(filter: SlotFilter): boolean {
	return (
		filter.query.trim() !== '' ||
		filter.calculated ||
		filter.needsReview ||
		filter.cadence !== null ||
		filter.group !== null
	);
}

/** A slot a calculation publishes: entered by a tool, or the output of one here. */
export function isCalculatedSlot(sp: SiteParameter, bySlot: Map<string, SlotCalculation[]>): boolean {
	return sp.entry_mode === 'tool' || (bySlot.get(sp.parameter_id) ?? []).some((c) => c.writes);
}

export function groupKey(group: Pick<SlotGroup, 'id'>): string {
	return group.id ?? 'ungrouped';
}

/**
 * The groups and slots a filter leaves, a group with none left dropped. The query matches the
 * parameter's code or name, case-insensitively.
 */
export function filterSlotGroups(
	groups: SlotGroup[],
	filter: SlotFilter,
	names: (parameterId: string) => { code: string; name: string },
	bySlot: Map<string, SlotCalculation[]>,
): SlotGroup[] {
	if (!isFiltering(filter)) return groups;
	const query = filter.query.trim().toLowerCase();
	const keeps = (sp: SiteParameter) => {
		if (filter.calculated && !isCalculatedSlot(sp, bySlot)) return false;
		if (filter.needsReview && !sp.needs_review) return false;
		if (filter.cadence && (sp.cadence === 'low' ? 'low' : 'high') !== filter.cadence) return false;
		if (!query) return true;
		const { code, name } = names(sp.parameter_id);
		return code.toLowerCase().includes(query) || name.toLowerCase().includes(query);
	};
	return groups
		.filter((g) => filter.group === null || groupKey(g) === filter.group)
		.map((g) => ({ ...g, slots: g.slots.filter(keeps) }))
		.filter((g) => g.slots.length > 0);
}
