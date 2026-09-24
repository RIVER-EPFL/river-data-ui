import { describe, expect, it } from 'vitest';

import type { EventPreview, VisitRow } from '$api/service';
import type { GridSlot } from './columns';
import {
	asking,
	awaitedAt,
	awaitingRun,
	failed,
	previewAsks,
	previewNotice,
	previewedAt,
	settled,
	signatureOf,
	skippedOf,
	unanswered,
	stagedCells,
	valuesOf,
	type PreviewAsk,
	type VisitPreview,
} from './preview';
import { spareRow } from './spareRows';
import { spareId } from './tableEdit';

const LOCALE = 'en-GB';

function replicate(index: number, value: number, streamId = 'stream-do') {
	return {
		replicate_index: index,
		value,
		stream_id: streamId,
		flagged: false,
		withdrawn: false,
		unverified: false,
	};
}

function visit(
	id: string,
	cells: Record<string, ReturnType<typeof replicate>[]>,
): VisitRow {
	return {
		id,
		collected_at: '2026-06-01T08:00:00Z',
		source: 'manual',
		parameters_filled: Object.keys(cells).length,
		findings_open: 0,
		unverified: false,
		recompute: 'current',
		cells: Object.entries(cells).map(([parameter_id, replicates]) => ({
			parameter_id,
			flagged: false,
			withdrawn: false,
			n_total: replicates.length,
			n_flagged: 0,
			n_withdrawn: 0,
			n_unverified: 0,
			has_provenance: false,
			replicates,
		})),
	} as unknown as VisitRow;
}

const visits = [
	visit('v1', { 'p-do': [replicate(0, 10), replicate(1, 20)] }),
	visit('v2', { 'p-do': [replicate(0, 9)] }),
];

function slot(
	parameterId: string,
	replicateIndex: number,
	expanded: boolean,
): GridSlot {
	return {
		parameterId,
		replicateIndex,
		column: { parameterId, expanded } as never,
	};
}

function ready(
	values: Record<string, number | null>,
	skipped: string[] = [],
): VisitPreview {
	return { signature: 's', state: 'ready', values, skipped, message: null };
}

describe('what the operator has staged at a visit', () => {
	it('sends a correction, a new repeat and a cleared stored cell, and nothing else', () => {
		const edits = {
			'v1|p-do|0': '4',
			'v1|p-do|1': '',
			'v1|p-do|2': '8',
			// A blank on a cell the store holds nothing at cancels the entry; it stages nothing.
			'v1|p-temp|0': '',
			// Text that is not a number says nothing about the value.
			'v1|p-cond|0': 'about nine',
		};
		expect(stagedCells(visits[0], edits, LOCALE)).toEqual([
			{ parameter_id: 'p-do', replicate_index: 0, value: 4 },
			{ parameter_id: 'p-do', replicate_index: 1, value: null },
			{ parameter_id: 'p-do', replicate_index: 2, value: 8 },
		]);
	});

	it('asks only about the visits typed into', () => {
		const asks = previewAsks(visits, { 'v2|p-do|0': '11' }, LOCALE);
		expect(asks.map((a) => a.eventId)).toEqual(['v2']);
		expect(asks[0].cells).toEqual([
			{ parameter_id: 'p-do', replicate_index: 0, value: 11 },
		]);
	});

	it('gives the same ask the same signature and a changed one a different signature', () => {
		const first = previewAsks(visits, { 'v1|p-do|0': '4' }, LOCALE)[0];
		const again = previewAsks(visits, { 'v1|p-do|0': '4' }, LOCALE)[0];
		const later = previewAsks(visits, { 'v1|p-do|0': '5' }, LOCALE)[0];
		expect(again.signature).toBe(first.signature);
		expect(later.signature).not.toBe(first.signature);
	});

	it('asks about a dated spare row at its site and instant, and not about an undated one', () => {
		const dated = spareRow(spareId(0), '2026-06-02T09:00:00.000Z');
		const undated = spareRow(spareId(1));
		const edits = { [`${dated.id}|p-do|0`]: '6', [`${undated.id}|p-do|0`]: '7' };
		const asks = previewAsks([...visits, dated, undated], edits, LOCALE);
		expect(asks).toHaveLength(1);
		expect(asks[0].eventId).toBe(dated.id);
		expect(asks[0].at).toBe('2026-06-02T09:00:00.000Z');
		expect(asks[0].cells).toEqual([{ parameter_id: 'p-do', replicate_index: 0, value: 6 }]);
	});

	it('asks a listed visit by its id alone', () => {
		expect(previewAsks(visits, { 'v1|p-do|0': '4' }, LOCALE)[0].at).toBeUndefined();
	});

	it('asks a spare row again when its date moves', () => {
		const edits = { [`${spareId(0)}|p-do|0`]: '6' };
		const morning = previewAsks([spareRow(spareId(0), '2026-06-02T09:00:00.000Z')], edits, LOCALE);
		const noon = previewAsks([spareRow(spareId(0), '2026-06-02T12:00:00.000Z')], edits, LOCALE);
		expect(noon[0].signature).not.toBe(morning[0].signature);
	});

	it('distinguishes a cleared cell from one nobody touched', () => {
		expect(
			signatureOf([{ parameter_id: 'p', replicate_index: 0, value: null }]),
		).toBe('p:0:');
		expect(
			signatureOf([{ parameter_id: 'p', replicate_index: 0, value: 0 }]),
		).toBe('p:0:0');
	});
});

describe('what a preview says a cell would hold', () => {
	const preview: EventPreview = {
		site_id: 's',
		collected_at: '2026-06-01T08:00:00Z',
		outputs: [
			{ output: 'out', parameter_id: 'p-out', replicate_index: 0, value: 8 },
			{ output: 'out', parameter_id: 'p-out', replicate_index: 1, value: 16 },
			{
				output: 'gone',
				parameter_id: 'p-gone',
				replicate_index: null,
				value: null,
			},
		],
		calculations: [],
		skipped: [['doc', 'an input did not resolve']],
		not_applicable: [],
		unchanged: [],
	} as unknown as EventPreview;

	it('reads the outputs by slot, a cleared one as a blank', () => {
		expect(valuesOf(preview)).toEqual({
			'p-out|0': 8,
			'p-out|1': 16,
			'p-gone|0': null,
		});
		expect(skippedOf(preview)).toEqual(['doc: an input did not resolve']);
	});

	it('shows an open group its own repeat and a collapsed one what it would serve', () => {
		const p = ready(valuesOf(preview));
		expect(previewedAt(p, slot('p-out', 1, true))).toBe(16);
		// Collapsed, the cell serves the statistic over the repeats: (8 + 16) / 2.
		expect(previewedAt(p, slot('p-out', 0, false))).toBe(12);
		expect(previewedAt(p, slot('p-gone', 0, false))).toBeNull();
	});

	it('says nothing about a slot no calculation wrote, or before the answer arrives', () => {
		const p = ready(valuesOf(preview));
		expect(previewedAt(p, slot('p-do', 0, false))).toBeUndefined();
		expect(previewedAt(undefined, slot('p-out', 0, false))).toBeUndefined();
		expect(
			previewedAt({ ...p, state: 'pending' }, slot('p-out', 0, false)),
		).toBeUndefined();
	});
});

describe('which ask is still the latest', () => {
	const answer = {
		outputs: [{ output: 'out', parameter_id: 'p-out', replicate_index: 0, value: 8 }],
		skipped: [],
	} as unknown as EventPreview;

	function ask(eventId: string, signature: string): PreviewAsk {
		return { eventId, signature, cells: [] };
	}

	it('sends only the asks it has no answer to', () => {
		const standing = { v1: ready({ 'p-out|0': 8 }) };
		standing.v1.signature = 'a';
		expect(unanswered(standing, [ask('v1', 'a')])).toEqual([]);
		expect(unanswered(standing, [ask('v1', 'b')]).map((a) => a.signature)).toEqual(['b']);
	});

	it('drops a visit nobody is typing into and reopens one whose values moved', () => {
		const standing = { v1: ready({ 'p-out|0': 8 }), v2: ready({ 'p-out|0': 1 }) };
		standing.v1.signature = 'a';
		const next = asking(standing, [ask('v1', 'b')]);
		expect(Object.keys(next)).toEqual(['v1']);
		// The last answer was about values the operator has since changed, so it stops standing.
		expect(next.v1.state).toBe('pending');
		expect(next.v1.values).toEqual({});
	});

	it('keeps an answer that is still about what is on the screen', () => {
		const standing = { v1: ready({ 'p-out|0': 8 }) };
		standing.v1.signature = 'a';
		expect(asking(standing, [ask('v1', 'a')]).v1).toBe(standing.v1);
	});

	it('returns the same previews when the asks change nothing', () => {
		const standing = { v1: ready({ 'p-out|0': 8 }) };
		standing.v1.signature = 'a';
		expect(asking(standing, [ask('v1', 'a')])).toBe(standing);
		expect(asking({}, [])).not.toBe(standing);
		expect(asking(standing, [])).not.toBe(standing);
	});

	it('takes the answer to the ask it made and drops one the operator has typed past', () => {
		const pending = asking({}, [ask('v1', 'b')]);
		expect(settled(pending, ask('v1', 'b'), answer).v1.values).toEqual({ 'p-out|0': 8 });
		// The slow first response arriving after the second ask went out changes nothing.
		expect(settled(pending, ask('v1', 'a'), answer)).toBe(pending);
		expect(failed(pending, ask('v1', 'a'), 'timed out')).toBe(pending);
		expect(failed(pending, ask('v1', 'b'), 'timed out').v1.state).toBe('error');
	});
});

describe('what the grid says about its previewed cells', () => {
	it('says it is still working while any visit is in flight', () => {
		const pending: VisitPreview = {
			signature: 's',
			state: 'pending',
			values: {},
			skipped: [],
			message: null,
		};
		expect(previewNotice({ v1: pending, v2: ready({}) })).toBe(
			'Calculating what these values give…',
		);
	});

	it('names the failure rather than leaving a stale number to read as current', () => {
		const errored: VisitPreview = {
			signature: 's',
			state: 'error',
			values: {},
			skipped: [],
			message: 'the runner is unreachable',
		};
		expect(previewNotice({ v1: errored })).toContain('the runner is unreachable');
	});

	it('counts the previewed cells and names what did not run', () => {
		expect(
			previewNotice({ v1: ready({ 'p-out|0': 8 }, ['doc: no input']) }),
		).toBe(
			'1 calculated value shown unsaved; Save writes them. Not run: doc: no input',
		);
		expect(previewNotice({})).toBeNull();
		expect(previewNotice({ v1: ready({}) })).toBeNull();
	});
});

describe('what a Save leaves on screen until its run lands', () => {
	const saved = visit('v1', { 'p-do': [replicate(0, 10)] });

	it('keeps a ready preview under its visit', () => {
		const awaiting = awaitingRun({ v1: ready({ 'p-out|0': 8 }) }, [saved]);
		expect(previewedAt(awaitedAt(awaiting, saved), slot('p-out', 0, false))).toBe(8);
	});

	it('keeps nothing that had no answer yet', () => {
		const pending: VisitPreview = { ...ready({}), state: 'pending' };
		const errored: VisitPreview = { ...ready({}), state: 'error', message: 'down' };
		expect(awaitingRun({ v1: pending, v2: errored }, visits)).toEqual({});
	});

	it('finds a spare row\'s preview on the visit the Save staged at its instant', () => {
		const spare = spareRow(spareId(0), '2026-06-01T10:00:00.000Z');
		const awaiting = awaitingRun({ [spare.id]: ready({ 'p-out|0': 3 }) }, [spare]);
		const staged = { ...visit('v9', {}), collected_at: '2026-06-01T10:00:00+00:00' } as VisitRow;
		expect(previewedAt(awaitedAt(awaiting, staged), slot('p-out', 0, false))).toBe(3);
		expect(awaitedAt(awaiting, saved)).toBeUndefined();
	});
});
