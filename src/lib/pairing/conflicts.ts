import type { PairingPlanEntry } from '$api/service';

import type { ReviewTab } from './reviewTabs';

/**
 * Something the plan holds that cannot be applied as it stands, as opposed to something still to
 * review: ticking the rows does not clear it, the code or the name has to change. Every one is the
 * server's own finding, carried through rather than recomputed here.
 */
export interface PlanConflict {
	tab: ReviewTab;
	kind: string;
	/** The name the conflict is about, as the row shows it. */
	subject: string;
	message: string;
}

const TAB_OF: Record<string, ReviewTab> = {
	catalog_match: 'parameters',
	duplicate_parameter_code: 'parameters',
	duplicate_site_name: 'sites',
	duplicate_project_name: 'projects',
};

/** The conflicts a plan carries, one per subject and kind, in the order the tabs are reviewed. */
export function planConflicts(entries: PairingPlanEntry[]): PlanConflict[] {
	const found = new Map<string, PlanConflict>();
	for (const e of entries) {
		for (const w of e.warnings ?? []) {
			const tab = TAB_OF[w.kind];
			if (!tab) continue;
			const subject =
				w.parameter ??
				(tab === 'sites' ? e.site.name : tab === 'projects' ? e.project.name : e.parameter.name);
			const key = `${w.kind}:${subject.toLowerCase()}`;
			if (found.has(key)) continue;
			found.set(key, { tab, kind: w.kind, subject, message: w.message });
		}
	}
	return [...found.values()];
}

/** The conflicts on one tab, for the gate and for the tab's own rows. */
export function conflictsOn(conflicts: PlanConflict[], tab: ReviewTab): PlanConflict[] {
	return conflicts.filter((c) => c.tab === tab);
}

/** The way out a catalog warning offers: attach to the entry, or choose whose units win. */
export type WarningResolution = 'attach' | 'units' | 'none';

export function resolutionOf(kind: string): WarningResolution {
	if (kind === 'catalog_match') return 'attach';
	if (kind === 'units_mismatch') return 'units';
	return 'none';
}
