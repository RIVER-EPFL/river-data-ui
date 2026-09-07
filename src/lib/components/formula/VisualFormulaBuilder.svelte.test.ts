import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Harness from './VisualFormulaBuilderHarness.test.svelte';

const variables = [
	{ name: 'DOC_ppb', label: 'DOC' },
	{ name: 'Depth', label: 'Water Depth' }
];

const formula = () => screen.getByTestId('formula').textContent;
const fn = (name: string) => screen.getByTitle(new RegExp(`drag ${name}\\(\\) into formula`));
const variable = (label: string) => screen.getByText(label).closest('[role="button"]')!;
// The canvas has no landmark of its own; the literal-number button sits in it.
const canvas = () => screen.getByTitle('Add a literal number you can type directly').parentElement!;
const token = (label: string) => within(canvas()).getByText(label).closest('[role="button"]')!;

describe('VisualFormulaBuilder', () => {
	it('fills a function argument from the palette', async () => {
		render(Harness, { variables });
		await fireEvent.click(fn('sqrt'));
		expect(formula()).toBe('sqrt(?)');

		await fireEvent.click(variable('DOC'));
		expect(formula()).toBe('sqrt(DOC_ppb)');
	});

	it('fills both arguments of a two-argument function in order', async () => {
		render(Harness, { variables });
		await fireEvent.click(fn('min'));
		await fireEvent.click(variable('DOC'));
		await fireEvent.click(variable('Water Depth'));
		expect(formula()).toBe('min(DOC_ppb, Depth)');
	});

	it('fills the argument a selected empty slot names', async () => {
		render(Harness, { variables });
		await fireEvent.click(fn('sqrt'));
		await fireEvent.click(screen.getByLabelText('Select empty slot'));
		await fireEvent.click(variable('Water Depth'));
		expect(formula()).toBe('sqrt(Depth)');
	});

	it('replaces a term inside a call rather than appending to the formula', async () => {
		render(Harness, { value: 'sqrt(DOC_ppb) + 1', variables });
		await fireEvent.click(token('DOC'));
		await fireEvent.click(variable('Water Depth'));
		expect(formula()).toBe('sqrt(Depth) + 1');
	});
});
