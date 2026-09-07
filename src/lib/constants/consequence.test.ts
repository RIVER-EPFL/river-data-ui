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

	it('names the calculations and says the save rewrites nothing', () => {
		const text = valueChangeConsequence(['doc', 'oxygen_saturation']);
		expect(text).toContain('2 active calculations read');
		expect(text).toContain('doc, oxygen_saturation');
		expect(text).toContain('rewrites nothing');
		expect(text).toContain('review queue');
		expect(text).toContain('recompute');
	});

	it('agrees with itself in the singular', () => {
		expect(valueChangeConsequence(['doc'])).toContain('1 active calculation reads');
	});
});
