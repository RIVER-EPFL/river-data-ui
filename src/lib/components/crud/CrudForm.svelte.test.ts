import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const CrudForm = (await import('./CrudForm.svelte')).default;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function client(over: Record<string, unknown> = {}) {
	return {
		get: vi.fn().mockResolvedValue({ value: 1 }),
		update: vi.fn().mockResolvedValue({ id: 'c1', value: 2 }),
		create: vi.fn().mockResolvedValue({ id: 'c1' }),
		...over,
	} as never;
}

const FIELDS = [{ key: 'value', label: 'Value', type: 'number' as const, step: 'any' }];

function mount(confirmSave: (p: Record<string, unknown>) => boolean | Promise<boolean>) {
	const c = client();
	render(CrudForm, {
		props: {
			client: c,
			entityId: 'c1',
			title: 'Edit Constant',
			backHref: '/parameters',
			fields: FIELDS,
			confirmSave,
		} as never,
	});
	return c as unknown as { update: ReturnType<typeof vi.fn> };
}

// Scenario: a save whose consequences reach beyond the row being edited, such as a constant whose
// new value recomputes every reading already computed from the old one.
describe('CrudForm confirmSave', () => {
	it('writes nothing when the confirmation is declined', async () => {
		const c = mount(() => false);
		await settle();
		await fireEvent.submit(screen.getByRole('button', { name: /Save|Update/i }).closest('form')!);
		await settle();
		expect(c.update).not.toHaveBeenCalled();
	});

	it('writes once the confirmation is given, with the payload it was asked about', async () => {
		const asked: Record<string, unknown>[] = [];
		const c = mount((p) => {
			asked.push(p);
			return true;
		});
		await settle();
		await fireEvent.submit(screen.getByRole('button', { name: /Save|Update/i }).closest('form')!);
		await settle();
		expect(asked).toHaveLength(1);
		expect(c.update).toHaveBeenCalledTimes(1);
		expect(c.update.mock.calls[0][1]).toEqual(asked[0]);
	});

	it('writes without asking when no confirmation is declared', async () => {
		const c = client();
		render(CrudForm, {
			props: {
				client: c,
				entityId: 'c1',
				title: 'Edit Constant',
				backHref: '/parameters',
				fields: FIELDS,
			} as never,
		});
		await settle();
		await fireEvent.submit(screen.getByRole('button', { name: /Save|Update/i }).closest('form')!);
		await settle();
		expect((c as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledTimes(1);
	});
});

// Scenario: a parameter's name is nearly always its code, so the name follows the code until
// somebody types a name of their own.
describe('CrudForm derivedFrom', () => {
	const DERIVED_FIELDS = [
		{ key: 'code', label: 'Code' },
		{ key: 'name', label: 'Name', derivedFrom: 'code' },
	];

	function mountNew() {
		const c = client();
		render(CrudForm, {
			props: {
				client: c,
				title: 'New Parameter',
				backHref: '/parameters',
				fields: DERIVED_FIELDS,
			} as never,
		});
		return c as unknown as { create: ReturnType<typeof vi.fn> };
	}

	it('fills the name from the code while the name is untouched', async () => {
		mountNew();
		const code = screen.getByLabelText(/Code/) as HTMLInputElement;
		const name = screen.getByLabelText(/Name/) as HTMLInputElement;
		await fireEvent.input(code, { target: { value: 'hs_co2_ppm' } });
		expect(name.value).toBe('hs_co2_ppm');
	});

	it('leaves a hand-typed name alone when the code changes afterwards', async () => {
		mountNew();
		const code = screen.getByLabelText(/Code/) as HTMLInputElement;
		const name = screen.getByLabelText(/Name/) as HTMLInputElement;
		await fireEvent.input(code, { target: { value: 'hs_co2' } });
		await fireEvent.input(name, { target: { value: 'Headspace CO2' } });
		await fireEvent.input(code, { target: { value: 'hs_co2_ppm' } });
		expect(name.value).toBe('Headspace CO2');
	});

	it('sends the derived name on create', async () => {
		const c = mountNew();
		const code = screen.getByLabelText(/Code/) as HTMLInputElement;
		await fireEvent.input(code, { target: { value: 'hs_co2_ppm' } });
		await fireEvent.submit(code.closest('form')!);
		await settle();
		expect(c.create).toHaveBeenCalledTimes(1);
		expect(c.create.mock.calls[0][0]).toMatchObject({ code: 'hs_co2_ppm', name: 'hs_co2_ppm' });
	});
});
