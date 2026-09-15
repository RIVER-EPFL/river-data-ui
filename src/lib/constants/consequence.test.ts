import { describe, expect, it } from 'vitest';
import { toolsDeclaring, valueChangeConsequence } from './consequence';

const tool = (name: string, constants: string[]) =>
	({ name, constants }) as unknown as import('$api/service').ToolDescriptor;

describe('constant edit consequence', () => {
	it('finds only the calculations that declare the constant', () => {
		const tools = [tool('doc', ['xO2']), tool('chla', ['molar_weight_o2'])];
		expect(toolsDeclaring(tools, 'xO2').map((t) => t.name)).toEqual(['doc']);
	});

	it('declares nothing for a constant with no name yet', () => {
		expect(toolsDeclaring([tool('doc', ['xO2'])], '')).toEqual([]);
	});

	it('says an unread constant changes nothing stored', () => {
		expect(valueChangeConsequence([])).toContain('changes nothing that is already stored');
	});

	it('names the calculations and says the save recomputes what they produced', () => {
		const text = valueChangeConsequence(['doc', 'oxygen_saturation']);
		expect(text).toContain('2 active calculations read');
		expect(text).toContain('doc, oxygen_saturation');
		expect(text).toContain('recomputes');
	});

	// A count that has not arrived is not a count of zero, and the message must not read as one.
	it('claims no count until the counts are known', () => {
		expect(valueChangeConsequence(['doc'])).not.toContain('Nothing stored');
	});

	it('agrees with itself in the singular', () => {
		expect(valueChangeConsequence(['doc'])).toContain('1 active calculation reads');
	});

	// The counts are what make the consequence concrete: an administrator deciding whether to
	// correct a molar weight is deciding about these readings, not about a category of them.
	it('counts the visits and readings already computed from it', () => {
		const text = valueChangeConsequence(['doc'], { name: 'xO2', visits: 412, readings: 1908 });
		expect(text).toContain('1,908 readings');
		expect(text).toContain('412 visits');
	});

	it('says so when nothing has been computed from it yet', () => {
		const text = valueChangeConsequence(['doc'], { name: 'xO2', visits: 0, readings: 0 });
		expect(text).toContain('Nothing stored');
		expect(text).not.toContain('0 readings');
	});

	it('agrees with itself for a single reading at a single visit', () => {
		const text = valueChangeConsequence(['doc'], { name: 'xO2', visits: 1, readings: 1 });
		expect(text).toContain('1 reading');
		expect(text).toContain('1 visit');
		expect(text).not.toContain('1 readings');
	});
});
