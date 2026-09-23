import { describe, expect, it } from 'vitest';

import type { PairingPlanEntry } from '$api/service';
import { conflictsOn, planConflicts, resolutionOf } from './conflicts';

function entry(over: {
	parameter?: string;
	site?: string;
	project?: string;
	warnings?: Array<{ kind: string; message: string; parameter?: string }>;
}): PairingPlanEntry {
	return {
		parameter: { name: over.parameter ?? 'Depth', units: 'mm' },
		site: { name: over.site ?? 'Martigny' },
		project: { name: over.project ?? 'CNET' },
		warnings: over.warnings ?? [],
	} as unknown as PairingPlanEntry;
}

describe('planConflicts', () => {
	it('sorts each finding onto the tab that can resolve it', () => {
		const conflicts = planConflicts([
			entry({
				parameter: 'DO',
				warnings: [
					{ kind: 'duplicate_parameter_code', message: "'DO' twice", parameter: 'DO' },
					{ kind: 'duplicate_site_name', message: 'also FP-1', parameter: 'FP1' },
					{ kind: 'units_mismatch', message: 'units differ' },
				],
			}),
		]);
		expect(conflicts.map((c) => [c.tab, c.subject])).toEqual([
			['parameters', 'DO'],
			['sites', 'FP1'],
		]);
		expect(conflictsOn(conflicts, 'sites').map((c) => c.message)).toEqual(['also FP-1']);
	});

	it('counts one subject once, however many streams carry it', () => {
		const warnings = [{ kind: 'catalog_match', message: "'DOC' exists", parameter: 'DOC' }];
		expect(planConflicts([entry({ warnings }), entry({ warnings })])).toHaveLength(1);
	});

	it('finds nothing in a plan whose warnings are all advisory', () => {
		expect(
			planConflicts([entry({ warnings: [{ kind: 'near_duplicate', message: 'reads alike' }] })]),
		).toEqual([]);
	});
});

describe('resolutionOf', () => {
	it('offers the attach on a code the catalog already holds', () => {
		expect(resolutionOf('catalog_match')).toBe('attach');
	});

	it('offers a choice of units only where the units disagree', () => {
		expect(resolutionOf('units_mismatch')).toBe('units');
	});

	it('offers neither on a finding with no catalog entry to act on', () => {
		expect(resolutionOf('near_duplicate')).toBe('none');
		expect(resolutionOf('duplicate_parameter_code')).toBe('none');
	});
});
