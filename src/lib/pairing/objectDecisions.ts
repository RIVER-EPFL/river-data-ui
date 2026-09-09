import type { PairingPlanEntry } from '$api/service';

import { entryStatus } from './entryStatus';

/// A decision the plan puts to the operator once, however many rows carry it.
///
/// A first import proposes one project, a dozen or so sites and a handful of parameters, and every
/// row naming one of them repeats the same question. The object is the unit: it is accepted once
/// and each row naming it reads as answered.
export type ObjectKind = 'project' | 'site' | 'parameter';

export interface ObjectDecision {
	key: string;
	kind: ObjectKind;
	name: string;
	/** Rows the plan would pair that name this object. */
	entryCount: number;
	/** Rows this acceptance would settle right now, the rest waiting on their own warnings. */
	settles: number;
	accepted: boolean;
}

/** The objects one entry proposes creating, in the order they read on the row. */
export function objectKeys(entry: PairingPlanEntry): string[] {
	const keys: string[] = [];
	if (entry.project.create) keys.push(`project:${entry.project.name}`);
	if (entry.site.create) keys.push(`site:${entry.site.name}`);
	if (entry.parameter.create) keys.push(`parameter:${entry.parameter.name}`);
	return keys;
}

/** The rows accepting `key` settles: every other object they name is accepted already. */
export function entriesSettledBy(
	entries: PairingPlanEntry[],
	key: string,
	accepted: ReadonlySet<string>,
): PairingPlanEntry[] {
	return entries.filter((e) => {
		const keys = objectKeys(e);
		if (!keys.includes(key) || e.acknowledged === true) return false;
		if (entryStatus(e).warnings > 0) return false;
		return keys.every((k) => k === key || accepted.has(k));
	});
}

/// Every object this plan creates, each with what accepting it answers.
///
/// Acceptance is the plan's own record, passed in: an object is one decision behind however many
/// rows name it, and no row can carry a decision it is waiting on. Ordered by how much it carries,
/// so the one decision behind a thousand rows is read first, and the ones still open come before
/// the ones already taken.
export function objectDecisions(
	entries: PairingPlanEntry[],
	acceptedKeys: Iterable<string> = [],
): ObjectDecision[] {
	const pairing = entries.filter((e) => e.action !== 'skip');
	const byKey = new Map<string, PairingPlanEntry[]>();
	for (const e of pairing) {
		for (const key of objectKeys(e)) {
			const arr = byKey.get(key);
			if (arr) arr.push(e);
			else byKey.set(key, [e]);
		}
	}
	const accepted = new Set(acceptedKeys);
	return [...byKey.entries()]
		.map(([key, rows]): ObjectDecision => {
			const [kind, ...rest] = key.split(':');
			return {
				key,
				kind: kind as ObjectKind,
				name: rest.join(':'),
				entryCount: rows.length,
				settles: entriesSettledBy(rows, key, accepted).length,
				accepted: accepted.has(key),
			};
		})
		.sort(
			(a, b) =>
				Number(a.accepted) - Number(b.accepted) ||
				b.entryCount - a.entryCount ||
				a.key.localeCompare(b.key),
		);
}

/** The set of accepted keys, for callers deciding what one more acceptance would settle. */
export function acceptedKeys(decisions: ObjectDecision[]): Set<string> {
	return new Set(decisions.filter((d) => d.accepted).map((d) => d.key));
}

/// What pressing Accept on one object does, in the words of its effect.
///
/// The object is created by the apply, accepted or not; accepting records the decision and ticks
/// whichever rows it completes, which may be none until their other objects are accepted too.
export function acceptHint(decision: ObjectDecision): string {
	if (decision.accepted) {
		return `${decision.name} is accepted. Click to take that back.`;
	}
	if (decision.settles === 0) {
		return `Record ${decision.name} as accepted. No row is ticked until the other objects it names are accepted too.`;
	}
	const rows = `${decision.settles} row${decision.settles === 1 ? '' : 's'}`;
	return `Record ${decision.name} as accepted, and tick the ${rows} it completes.`;
}
