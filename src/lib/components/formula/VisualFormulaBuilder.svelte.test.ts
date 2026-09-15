import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Harness from './VisualFormulaBuilderHarness.test.svelte';

const variables = [
	{ name: 'DOC_ppb', label: 'DOC' },
	{ name: 'Depth', label: 'Water Depth' }
];

const formula = () => screen.getByTestId('formula').textContent;
// Functions start collapsed, so reaching one is opening the section and taking the chip.
async function fn(name: string) {
	if (screen.queryByTitle(new RegExp(`drag ${name}\\(\\) into formula`)) === null) {
		await fireEvent.click(section('Functions'));
	}
	return screen.getByTitle(new RegExp(`drag ${name}\\(\\) into formula`));
}
// The palette lists a parameter by its code, one line each; the canvas shows its label.
const palette = () => screen.getByPlaceholderText('Search…').parentElement!;
const variable = (code: string) => within(palette()).getByText(code).closest('[role="button"]')!;
const section = (name: string) => screen.getByRole('button', { name: new RegExp(`^. ${name}`) });
const textBox = () => screen.getByRole('combobox') as HTMLInputElement;

async function type(text: string) {
	const input = textBox();
	input.value = text;
	input.setSelectionRange(text.length, text.length);
	await fireEvent.input(input);
}
// The canvas has no landmark of its own; the literal-number button sits in it.
const canvas = () => screen.getByTitle('Add a literal number you can type directly').parentElement!;
const token = (label: string) => within(canvas()).getByText(label).closest('[role="button"]')!;

describe('VisualFormulaBuilder', () => {
	it('fills a function argument from the palette', async () => {
		render(Harness, { variables });
		await fireEvent.click(await fn('sqrt'));
		expect(formula()).toBe('sqrt(?)');

		await fireEvent.click(variable('DOC_ppb'));
		expect(formula()).toBe('sqrt(DOC_ppb)');
	});

	it('fills both arguments of a two-argument function in order', async () => {
		render(Harness, { variables });
		await fireEvent.click(await fn('min'));
		await fireEvent.click(variable('DOC_ppb'));
		await fireEvent.click(variable('Depth'));
		expect(formula()).toBe('min(DOC_ppb, Depth)');
	});

	it('fills the argument a selected empty slot names', async () => {
		render(Harness, { variables });
		await fireEvent.click(await fn('sqrt'));
		await fireEvent.click(screen.getByLabelText('Select empty slot'));
		await fireEvent.click(variable('Depth'));
		expect(formula()).toBe('sqrt(Depth)');
	});

	it('replaces a term inside a call rather than appending to the formula', async () => {
		render(Harness, { value: 'sqrt(DOC_ppb) + 1', variables });
		await fireEvent.click(token('DOC'));
		await fireEvent.click(variable('Depth'));
		expect(formula()).toBe('sqrt(Depth) + 1');
	});

	it('offers every parameter sharing what is typed, and inserts the one chosen', async () => {
		const headspace = [
			{ name: 'hs_co2_ppm', label: 'Headspace CO2' },
			{ name: 'hs_h2o_pct', label: 'Headspace water' },
			{ name: 'Depth', label: 'Water Depth' }
		];
		render(Harness, { variables: headspace });
		await type('hs_');

		const offered = within(screen.getByLabelText('Name completions')).getAllByRole('button');
		expect(offered.map((b) => b.textContent?.trim().split(/\s+/)[0])).toEqual([
			'hs_co2_ppm',
			'hs_h2o_pct'
		]);

		await fireEvent.keyDown(textBox(), { key: 'Enter' });
		expect(formula()).toBe('hs_co2_ppm');
	});

	it('finds a parameter whose code says nothing by its label', async () => {
		render(Harness, { variables: [{ name: 'DOC_ppb', label: 'Dissolved organic carbon' }] });
		await type('dissolved');
		expect(within(screen.getByLabelText('Name completions')).getByText('DOC_ppb')).toBeTruthy();
	});

	it('leaves the name list closed once it is dismissed', async () => {
		render(Harness, { variables });
		await type('DO');
		expect(screen.getByLabelText('Name completions')).toBeTruthy();

		await fireEvent.keyDown(textBox(), { key: 'Escape' });
		expect(screen.queryByLabelText('Name completions')).toBeNull();
	});

	it('opens a collapsed palette section, and counts what it holds while closed', async () => {
		render(Harness, { variables });
		expect(within(palette()).queryByText('sqrt()')).toBeNull();

		await fireEvent.click(section('Functions'));
		expect(within(palette()).getByText('sqrt()')).toBeTruthy();
	});
});
