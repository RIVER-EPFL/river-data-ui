import { describe, expect, it } from 'vitest';

import type { ProvenanceRecord } from '$api/service';
import { computedOrigin, isComputed, valueLabel, windowStartText } from './recordLabels';

function record(parts: Partial<ProvenanceRecord> & { measurement_type?: string }): ProvenanceRecord {
	const { measurement_type = 'spot', ...rest } = parts;
	return {
		chain: {},
		holds: [],
		origin: { classification: 'manual', source_system: 'grab_sample', source_key: 'k', stream_id: 's' },
		readings: [{ measurement_type, replicate_index: 0, raw_value: 1 }],
		...rest,
	} as unknown as ProvenanceRecord;
}

const chainRun = { computation: { provenance: {}, run_source: 'chain', created_by: 'admin' } };
const abstar = {
	calculation: { code: 'ABstar', name: 'ABstar', definition_id: 'd', tool_script_id: 't' },
	inputs: [
		{ definition_id: 'd', formula_code: 'ABstar', variable_name: 'A', parameter_code: 'A', served_as: 'x' },
		{ definition_id: 'd', formula_code: 'ABstar', variable_name: 'B', parameter_code: 'B', served_as: 'x' },
		{ definition_id: 'd', formula_code: 'ABstar', variable_name: 'A', parameter_code: 'A', served_as: 'x' },
	],
};

describe('what a record calls its value', () => {
	it('calls a value the chain computed computed, not measured', () => {
		expect(valueLabel(record({ ...chainRun, ...abstar } as never))).toBe('Computed');
	});

	it("calls a portal calculation's value computed", () => {
		const portal = record({
			origin: {
				classification: 'sync',
				source_system: 'cnet',
				source_key: 'k',
				stream_id: 's',
				portal_calculation: { function: 'calcRatio', inputs: [{ column: 'A' }, { column: 'T' }] },
			},
		} as never);
		expect(isComputed(portal)).toBe(true);
		expect(valueLabel(portal)).toBe('Computed');
		expect(computedOrigin(portal)).toBe('computed by calcRatio from A, T');
	});

	it('calls a grab with an instrument measured, and one typed with none entered', () => {
		expect(valueLabel(record({ chain: { sensor: { id: 'x' } } } as never))).toBe('Measured');
		expect(valueLabel(record({}))).toBe('Entered');
	});

	it('calls a logger value measured', () => {
		const logger = record({
			measurement_type: 'continuous',
			origin: { classification: 'sync', source_system: 'viewlinc', source_key: 'k', stream_id: 's' },
		} as never);
		expect(valueLabel(logger)).toBe('Measured');
	});
});

describe('where a computed record came from', () => {
	it('names the calculation and each input once', () => {
		expect(computedOrigin(record({ ...chainRun, ...abstar } as never))).toBe(
			'computed by ABstar from A, B',
		);
	});

	it('names nothing for a value nothing computed', () => {
		expect(computedOrigin(record({}))).toBeNull();
	});
});

describe('the start of a reconciliation window', () => {
	it('reads an unbounded start as the beginning', () => {
		expect(windowStartText('1000-01-01T00:00:00Z')).toBe('from the beginning');
	});

	it('reads a real start as its instant', () => {
		expect(windowStartText('2024-09-01T00:00:00Z')).not.toBe('from the beginning');
	});
});
