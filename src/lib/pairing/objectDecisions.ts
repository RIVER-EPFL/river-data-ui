import type { PairingPlanEntry } from '$api/service';

/// A project or parameter the plan pairs streams onto, reviewed once however many rows name it.
///
/// Reviewing a new one confirms it should be created; reviewing an existing one confirms the
/// streams belong on it. Either way the plan records the key, and a created parameter nobody
/// reviewed is minted `needs_review`.
export type ObjectKind = 'project' | 'parameter';

export interface ObjectDecision {
	key: string;
	kind: ObjectKind;
	name: string;
	/** The apply creates it; otherwise it already exists. */
	create: boolean;
	/** Rows the plan would pair that name this object. */
	entryCount: number;
	/** Distinct sites those rows are at. */
	siteCount: number;
	reviewed: boolean;
}

/** The review key for one kind of object on one entry. */
export function objectKey(kind: ObjectKind, entry: PairingPlanEntry): string {
	return kind === 'project' ? `project:${entry.project.name}` : `parameter:${entry.parameter.name}`;
}

/// Every project or parameter the plan's pairing rows name, with whether it has been reviewed.
///
/// Ordered with the ones still to review first, then by how many rows they carry.
export function objectDecisions(
	entries: PairingPlanEntry[],
	kind: ObjectKind,
	reviewedKeys: Iterable<string> = [],
): ObjectDecision[] {
	const byKey = new Map<string, PairingPlanEntry[]>();
	for (const e of entries) {
		if (e.action === 'skip') continue;
		const key = objectKey(kind, e);
		const arr = byKey.get(key);
		if (arr) arr.push(e);
		else byKey.set(key, [e]);
	}
	const reviewed = new Set(reviewedKeys);
	return [...byKey.entries()]
		.map(([key, rows]): ObjectDecision => {
			const first = rows[0]!;
			const target = kind === 'project' ? first.project : first.parameter;
			return {
				key,
				kind,
				name: target.name,
				create: rows.some((r) => (kind === 'project' ? r.project.create : r.parameter.create)),
				entryCount: rows.length,
				siteCount: new Set(rows.map((r) => r.site.name)).size,
				reviewed: reviewed.has(key),
			};
		})
		.sort(
			(a, b) =>
				Number(a.reviewed) - Number(b.reviewed) ||
				b.entryCount - a.entryCount ||
				a.key.localeCompare(b.key),
		);
}
