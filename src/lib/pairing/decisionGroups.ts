import type { PairingPlanEntry } from '$api/service';
import { entryStatus, reviewState } from './entryStatus';

/**
 * The rows that pose the same question, together.
 *
 * A first sync does not leave 1,679 distinct problems: it leaves a handful repeated, one
 * unregistered instrument across every stream it produced, one site whose name does not match,
 * one unit that disagrees. Worked as a flat list an operator answers the same question hundreds of
 * times with nothing showing that it was the same question. Grouping is what turns the gate Q133
 * asked for into an afternoon rather than a week.
 *
 * Only `needs_checking` rows are grouped. A self-validated row asks nothing, and an acknowledged
 * one has been answered.
 */
export interface DecisionGroup {
	/** Stable across reloads: the same question always produces the same key. */
	key: string;
	/** What the rows have in common, as the review says it. */
	label: string;
	/** The parts of the question, for a caller that wants to render them separately. */
	reasons: string[];
	entries: PairingPlanEntry[];
	siteCount: number;
}

/**
 * What one entry is waiting on: what it would create, and what it warned about.
 *
 * The kinds are what group, not the messages: a message names the row ("units differ: mm vs m"),
 * the kind names the question ("units differ"), and it is the question that is shared.
 */
export function decisionReasons(entry: PairingPlanEntry): string[] {
	const status = entryStatus(entry);
	const reasons = status.creates.map((what) => `new ${what}`);
	reasons.push(...status.warningKinds);
	if (reasons.length === 0 && !status.matched) reasons.push('unresolved');
	return [...new Set(reasons)].sort();
}

/** How the group reads in the review. */
export function decisionLabel(reasons: string[]): string {
	if (reasons.length === 0) return 'nothing outstanding';
	return reasons.map((reason) => reason.replace(/_/g, ' ')).join(', ');
}

/**
 * The `needs_checking` entries grouped by the question they pose, biggest group first.
 *
 * Biggest first because that is where one decision buys the most: the group of 400 streams waiting
 * on one instrument is the reason this exists, and it should not be below the group of one.
 */
export function decisionGroups(entries: PairingPlanEntry[]): DecisionGroup[] {
	const groups = new Map<string, DecisionGroup>();
	for (const entry of entries) {
		if (reviewState(entry) !== 'needs_checking') continue;
		const reasons = decisionReasons(entry);
		const key = reasons.join('|') || 'unresolved';
		const group = groups.get(key);
		if (group) {
			group.entries.push(entry);
		} else {
			groups.set(key, {
				key,
				label: decisionLabel(reasons),
				reasons,
				entries: [entry],
				siteCount: 0,
			});
		}
	}
	const out = [...groups.values()];
	for (const group of out) {
		group.siteCount = new Set(group.entries.map((entry) => entry.site.name).filter(Boolean)).size;
	}
	// Biggest first, then by label so equal groups do not reorder between renders.
	out.sort((a, b) => b.entries.length - a.entries.length || a.label.localeCompare(b.label));
	return out;
}

/** How far a group reaches, for the control that selects it. */
export function decisionScopeLabel(group: DecisionGroup): string {
	const streams = `${group.entries.length} stream${group.entries.length === 1 ? '' : 's'}`;
	return group.siteCount > 1 ? `${streams} at ${group.siteCount} sites` : streams;
}
