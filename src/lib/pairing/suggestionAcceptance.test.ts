import { describe, expect, it } from 'vitest';

import type { PlanInstrumentGroup } from '$api/service';
import { suggestionAcceptance, type InstrumentDecision } from './planGroups';

function decision(over: Partial<InstrumentDecision> = {}): InstrumentDecision {
	return {
		key: 'DOC',
		scope: 'DOC',
		name: 'DOC',
		proposedName: 'DOC',
		group: null,
		parameters: ['DOC'],
		siteCount: 1,
		streamCount: 1,
		anchorStreamId: 'doc-stream',
		nameConflict: null,
		...over,
	};
}

function group(over: Partial<PlanInstrumentGroup>): PlanInstrumentGroup {
	return { create: true, confirmed: false, ...over } as PlanInstrumentGroup;
}

describe('suggestionAcceptance', () => {
	it('confirms a proposal nobody confirmed, keeping its name', () => {
		const { updates, held } = suggestionAcceptance([decision({ group: group({}) })]);
		expect(updates).toEqual([{ stream_id: 'doc-stream', instrument_confirmed: true }]);
		expect(held).toBe(0);
	});

	it('names and confirms a parameter with nothing attached', () => {
		const { updates } = suggestionAcceptance([decision({ proposedName: 'TSS' })]);
		expect(updates).toEqual([
			{ stream_id: 'doc-stream', instrument_name: 'TSS', instrument_confirmed: true },
		]);
	});

	it('leaves a confirmed proposal and an existing instrument alone', () => {
		const { updates, held } = suggestionAcceptance([
			decision({ group: group({ confirmed: true }) }),
			decision({ group: group({ create: false, confirmed: true }) }),
		]);
		expect(updates).toEqual([]);
		expect(held).toBe(0);
	});

	it('holds back a suggestion whose name an instrument already carries', () => {
		const { updates, held } = suggestionAcceptance([
			decision({
				group: group({}),
				nameConflict: { id: 'x', name: 'DOC', has_readings: true } as InstrumentDecision['nameConflict'],
			}),
		]);
		expect(updates).toEqual([]);
		expect(held).toBe(1);
	});
});
