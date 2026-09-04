import type { PairingPlanEntry } from '$api/service';

/// What the catalog made of one entry, read from the fields the plan already carries.
export interface EntryStatus {
	/** Every one of project, site and parameter resolved to an existing entity. */
	matched: boolean;
	/** Which of them this plan would create, in the order they read on the row. */
	creates: Array<'project' | 'site' | 'parameter'>;
	warnings: number;
	warningKinds: string[];
	action: 'pair' | 'skip';
}

export type EntryFilter = 'all' | 'pair' | 'skip' | 'unmatched' | 'warnings';

export function entryStatus(entry: PairingPlanEntry): EntryStatus {
	const creates: EntryStatus['creates'] = [];
	if (entry.project.create) creates.push('project');
	if (entry.site.create) creates.push('site');
	if (entry.parameter.create) creates.push('parameter');
	const kinds = (entry.warnings ?? []).map((w) => w.kind);
	return {
		matched: creates.length === 0 && !!entry.project.id && !!entry.site.id && !!entry.parameter.id,
		creates,
		warnings: kinds.length,
		warningKinds: [...new Set(kinds)],
		action: entry.action === 'skip' ? 'skip' : 'pair',
	};
}

/** One entry's membership of a review filter. The bulk actions select on the same predicate. */
export function matchesFilter(entry: PairingPlanEntry, filter: EntryFilter): boolean {
	const status = entryStatus(entry);
	switch (filter) {
		case 'pair':
			return status.action === 'pair';
		case 'skip':
			return status.action === 'skip';
		case 'unmatched':
			return !status.matched;
		case 'warnings':
			return status.warnings > 0;
		default:
			return true;
	}
}

/** The row's short legend: a tick when everything matched, the creations otherwise. */
export function statusLabel(status: EntryStatus): string {
	if (status.matched) return 'matched';
	if (status.creates.length === 0) return 'unresolved';
	return `new ${status.creates.join(', ')}`;
}
