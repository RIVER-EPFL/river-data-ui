import { describe, expect, it } from 'vitest';
import { instrumentIsChoosable, readingInstrument } from './rowInstrument';

describe('the instrument a saved row carries', () => {
	const base = { curveId: null, curveInstrumentId: null, declared: null };

	it("is the operator's declaration when they made one", () => {
		expect(readingInstrument({ ...base, declared: 'backup-titrator' })).toBe('backup-titrator');
	});

	it("is nothing when they made none, so the slot's declaration resolves server-side", () => {
		expect(readingInstrument(base)).toBeNull();
		expect(readingInstrument({ ...base, declared: '' })).toBeNull();
	});

	it("is the curve's instrument where a curve corrected the row, whatever was declared", () => {
		expect(
			readingInstrument({
				curveId: 'curve-1',
				curveInstrumentId: 'lab-doc',
				declared: 'backup-titrator',
			}),
		).toBe('lab-doc');
	});

	it('is the declaration again when a curve is chosen but names no instrument', () => {
		expect(
			readingInstrument({ curveId: 'curve-1', curveInstrumentId: null, declared: 'backup' }),
		).toBe('backup');
	});

	it('is offered on an uncorrected row and stated on a corrected one', () => {
		expect(instrumentIsChoosable(null, null)).toBe(true);
		expect(instrumentIsChoosable('curve-1', 'lab-doc')).toBe(false);
		expect(instrumentIsChoosable('curve-1', null)).toBe(true);
	});
});
