import { describe, expect, it } from 'vitest';

import type { EventDetailResponse } from '$api/service';
import { connectionsOf, covers } from './connections';

const AT = '2026-07-14T09:00:00Z';

function member(streamId: string, replicateIndex: number, time = AT) {
	return {
		stream_id: streamId,
		time,
		replicate_index: replicateIndex,
		revision: 1,
		value: 10,
		current_revision: 1,
		current_value: 10,
		state: 'unchanged',
	};
}

function cell(
	parameterId: string,
	streamId: string,
	options: { replicates?: number[]; consumed?: ReturnType<typeof member>[][] } = {},
) {
	const replicates = options.replicates ?? [0];
	return {
		parameter_id: parameterId,
		parameter_code: parameterId,
		parameter_name: parameterId,
		origin: 'manual',
		has_provenance: false,
		stream_id: streamId,
		replicates: replicates.map((replicate_index) => ({
			replicate_index,
			value: 10,
			stream_id: streamId,
			flagged: false,
			withdrawn: false,
			unverified: false,
		})),
		record: {
			origin: { stream_id: streamId, source_system: 'grab_sample', source_key: parameterId, classification: 'manual' },
			readings: [],
			chain: {},
			holds: [],
			consumed: (options.consumed ?? []).map((members, i) => ({
				variable: `v${i}`,
				kind: 'reading',
				revision: null,
				current_revision: null,
				value: 10,
				state: 'unchanged',
				members,
			})),
		},
	};
}

function detail(cells: unknown[]): EventDetailResponse {
	return {
		id: 'event-1',
		site_id: 'site-1',
		collected_at: AT,
		cells,
	} as unknown as EventDetailResponse;
}

describe('visit cell connections', () => {
	// pco2 was computed from temp; selecting either lights up the other.
	const computed = () =>
		detail([
			cell('temp', 'stream-temp'),
			cell('pco2', 'stream-pco2', { consumed: [[member('stream-temp', 0)]] }),
		]);

	it('names the reading a computed cell consumed', () => {
		expect(connectionsOf(computed(), 'pco2')).toEqual({
			reads: [{ parameterId: 'temp', replicateIndex: 0 }],
			readBy: [],
		});
	});

	it('names the output that consumed an input cell', () => {
		expect(connectionsOf(computed(), 'temp')).toEqual({
			reads: [],
			readBy: [{ parameterId: 'pco2', replicateIndex: 0 }],
		});
	});

	it('connects nothing for a cell no calculation touched', () => {
		const plain = detail([cell('ph', 'stream-ph'), cell('temp', 'stream-temp')]);
		expect(connectionsOf(plain, 'ph')).toEqual({ reads: [], readBy: [] });
	});

	it('resolves a replicate family to each repeat it read', () => {
		const family = detail([
			cell('doc', 'stream-doc', { replicates: [0, 1, 2] }),
			cell('doc_mean', 'stream-mean', {
				consumed: [[member('stream-doc', 0), member('stream-doc', 2)]],
			}),
		]);
		expect(connectionsOf(family, 'doc_mean').reads).toEqual([
			{ parameterId: 'doc', replicateIndex: 0 },
			{ parameterId: 'doc', replicateIndex: 2 },
		]);
	});

	it('leaves a reading from another instant out, so a highlight cannot cross visits', () => {
		const elsewhere = detail([
			cell('temp', 'stream-temp'),
			cell('pco2', 'stream-pco2', {
				consumed: [[member('stream-temp', 0, '2026-07-13T09:00:00Z')]],
			}),
		]);
		expect(connectionsOf(elsewhere, 'pco2').reads).toEqual([]);
		expect(connectionsOf(elsewhere, 'temp').readBy).toEqual([]);
	});

	it('leaves a stream this visit does not hold out, so a same-named parameter elsewhere is not lit', () => {
		const foreign = detail([
			cell('temp', 'stream-temp'),
			cell('pco2', 'stream-pco2', { consumed: [[member('stream-other-site', 0)]] }),
		]);
		expect(connectionsOf(foreign, 'pco2').reads).toEqual([]);
	});

	it('answers for a parameter two streams serve, from both records', () => {
		const duplicate = detail([
			cell('temp', 'stream-a'),
			cell('temp', 'stream-b'),
			cell('pco2', 'stream-pco2', { consumed: [[member('stream-b', 0)]] }),
		]);
		expect(connectionsOf(duplicate, 'temp').readBy).toEqual([
			{ parameterId: 'pco2', replicateIndex: 0 },
		]);
	});

	it('lights every repeat of the consuming group, not only its first', () => {
		const perReplicate = detail([
			cell('doc', 'stream-doc', { replicates: [0, 1] }),
			cell('doc_c', 'stream-docc', {
				replicates: [0, 1],
				consumed: [[member('stream-doc', 0)]],
			}),
		]);
		expect(connectionsOf(perReplicate, 'doc').readBy).toEqual([
			{ parameterId: 'doc_c', replicateIndex: 0 },
			{ parameterId: 'doc_c', replicateIndex: 1 },
		]);
	});
});

describe('covering a grid position', () => {
	const slots = [{ parameterId: 'doc', replicateIndex: 2 }];

	it('matches the exact repeat of an open column', () => {
		expect(covers(slots, 'doc', 2, true)).toBe(true);
		expect(covers(slots, 'doc', 0, true)).toBe(false);
	});

	it('matches a collapsed group whichever repeat was read', () => {
		expect(covers(slots, 'doc', 0, false)).toBe(true);
	});

	it('matches no other parameter', () => {
		expect(covers(slots, 'ph', 2, false)).toBe(false);
	});
});
