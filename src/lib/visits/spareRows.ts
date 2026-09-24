import type { VisitRow } from '$api/service';
import { formatCompactInstant, fromDatetimeLocal } from '$lib/utils';
import { isSpare, spareId, type Edits } from './tableEdit';

// The spare area under the last listed visit. A row there names its own date, so a field day
// pasted below the table stages the visits it describes instead of being dropped for want of them.
// A date the site already holds a visit at is refused rather than joined (Q225), and so is a date
// two spare rows both name.
//
// A typed date is read as wall clock in the zone the date column prints, so what is typed and what
// comes back read the same; one carrying its own offset keeps it.

/** The instant a date cell names, or nothing where it names none. A bare date is that day's start. */
function instantOf(text: string, zone: string | undefined): string | null {
	const naive = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00` : text;
	if (Number.isNaN(Date.parse(naive)) && Number.isNaN(Date.parse(`${naive}Z`))) return null;
	return fromDatetimeLocal(naive, zone);
}

/** A row of the spare area: what it names, and what stops it staging a visit. */
export interface SpareVisit {
	id: string;
	/** The date cell as typed or pasted. */
	typed: string;
	/** The instant it stages a visit at, null while it names none the table can use. */
	collectedAt: string | null;
	/** Why it stages nothing, in the operator's terms. */
	problem: string | null;
}

/**
 * The instants this site already holds a visit at: the rows the grid lists, and whatever the
 * lookup found beyond them. The grid may be filtered or paged, so a listing is never the whole
 * site (Q225).
 */
export function standingInstants(visits: VisitRow[], found: Iterable<string> = []): Set<string> {
	return new Set([...visits.map((v) => v.collected_at), ...found].map(normalise));
}

function normalise(instant: string): string {
	return new Date(instant).toISOString();
}

/**
 * The spare rows under the last visit, in grid order. `count` is how many the grid draws, so a row
 * nobody has typed into is a blank one waiting rather than a refusal.
 */
export function spareVisits(
	typed: Readonly<Record<string, string>>,
	count: number,
	standing: ReadonlySet<string>,
	zone?: string,
): SpareVisit[] {
	const named = new Set<string>();
	return Array.from({ length: count }, (_, index) => {
		const id = spareId(index);
		const text = (typed[id] ?? '').trim();
		const blank = { id, typed: text, collectedAt: null };
		if (text === '') return { ...blank, problem: null };
		const at = instantOf(text, zone);
		if (at === null) return { ...blank, problem: `${text} is not a date` };
		if (standing.has(at)) return { ...blank, problem: `a visit already stands at ${text}` };
		if (named.has(at)) return { ...blank, problem: `another new row names ${text}` };
		named.add(at);
		return { id, typed: text, collectedAt: at, problem: null };
	});
}

/** The instants the spare rows name, for the lookup that says which of them already stand. */
export function namedInstants(
	typed: Readonly<Record<string, string>>,
	count: number,
	zone?: string,
): string[] {
	return spareVisits(typed, count, new Set(), zone)
		.map((s) => s.collectedAt)
		.filter((at): at is string => at !== null);
}

/** What a staged row says it is doing, with the UTC instant its date resolved to. */
export function stagedLabel(collectedAt: string): string {
	return `new visit at ${formatCompactInstant(collectedAt, 'UTC')}Z`;
}

/**
 * How many spare rows stand under the last visit: every one in use, an empty one waiting below
 * them, and however many more the plus has asked for.
 */
export function spareCount(
	typed: Readonly<Record<string, string>>,
	edits: Edits,
	asked: number,
): number {
	const used = [...Object.keys(typed), ...Object.keys(edits).map((k) => k.split('|')[0])]
		.filter(isSpare)
		.reduce((widest, id) => Math.max(widest, spareIndex(id) + 1), 0);
	return Math.max(used + 1, asked, 1);
}

/** The place a spare row holds in the spare area, counting from the first one under the table. */
export function spareIndex(id: string): number {
	return Number(id.slice(id.indexOf(':') + 1));
}

/** The row a spare stands as while it has no visit of its own: a visit holding nothing. */
export function spareRow(id: string, collectedAt: string | null = null): VisitRow {
	return {
		id,
		collected_at: collectedAt ?? '',
		cells: [],
		source: 'manual',
		recompute: 'current',
		parameters_filled: 0,
		findings_open: 0,
		unverified: false,
	};
}

/** Every row the grid draws: the visits the store holds, then the spare rows under them. */
export function gridRows(visits: VisitRow[], spares: SpareVisit[]): VisitRow[] {
	return [...visits, ...spares.map((s) => spareRow(s.id, s.collectedAt))];
}

/**
 * The edits a Save may write: everything on a listed visit, and everything on a spare row that
 * stages one. What was typed on a refused row stays on screen and is saved by nothing.
 */
export function writableEdits(edits: Edits, spares: SpareVisit[]): Edits {
	const staging = new Set(spares.filter((s) => s.collectedAt !== null).map((s) => s.id));
	return Object.fromEntries(
		Object.entries(edits).filter(([key]) => {
			const eventId = key.split('|')[0];
			return !isSpare(eventId) || staging.has(eventId);
		}),
	);
}

/** The spare rows a Save stages, in grid order. */
export function staging(spares: SpareVisit[]): { id: string; collectedAt: string }[] {
	return spares
		.filter((s) => s.collectedAt !== null)
		.map((s) => ({ id: s.id, collectedAt: s.collectedAt as string }));
}

/** What the spare area refused, said in one line beside the Save rather than as a toast. */
export function spareNotice(spares: SpareVisit[], edits: Edits): string | null {
	const valued = new Set(Object.keys(edits).map((k) => k.split('|')[0]));
	const notes = spares.filter((s) => s.problem !== null).map((s) => s.problem as string);
	const undated = spares.filter(
		(s) => s.problem === null && s.collectedAt === null && valued.has(s.id),
	).length;
	if (undated > 0) {
		notes.push(
			`${undated} new row${undated === 1 ? '' : 's'} hold${undated === 1 ? 's' : ''} values with no date`,
		);
	}
	return notes.length > 0 ? `${notes.join('. ')}.` : null;
}

/** The values a save moves and the visits its spare rows open, counted in one phrase. */
export function saveCounts(values: number, visits: number): string {
	const moved = `${values} value${values === 1 ? '' : 's'}`;
	return visits > 0 ? `${moved} and ${visits} new visit${visits === 1 ? '' : 's'}` : moved;
}

/** What the Save button says, so opening a visit is never something a save does silently. */
export function saveLabel(values: number, visits: number): string {
	return `Save ${saveCounts(values, visits)}`;
}

/** What the save reports afterwards. */
export function savedLine(values: number, visits: number): string {
	return `${saveCounts(values, visits)} saved`;
}

/**
 * What stays on screen after a save: the dates and cells of the spare rows it could not write,
 * so a row refused between the lookup and the Save is still there to correct.
 */
export function keptAfterSave(
	edits: Edits,
	dates: Readonly<Record<string, string>>,
	kept: ReadonlySet<string>,
): { edits: Edits; dates: Record<string, string> } {
	const own = (key: string) => kept.has(key.split('|')[0]);
	return {
		edits: Object.fromEntries(Object.entries(edits).filter(([key]) => own(key))),
		dates: Object.fromEntries(Object.entries(dates).filter(([id]) => kept.has(id))),
	};
}

/** The spare rows a stage found already standing, by the instants it reported back. */
export function racedRows(
	spares: SpareVisit[],
	staged: { collected_at: string; created: boolean }[],
): Set<string> {
	const stood = new Set(staged.filter((e) => !e.created).map((e) => normalise(e.collected_at)));
	return new Set(
		spares.filter((s) => s.collectedAt !== null && stood.has(s.collectedAt)).map((s) => s.id),
	);
}

/** The first grid row holding one of the visits a save or the New visit dialog just opened, or -1. */
export function landedRow(rows: readonly { id: string }[], opened: ReadonlySet<string>): number {
	return rows.findIndex((row) => opened.has(row.id));
}
