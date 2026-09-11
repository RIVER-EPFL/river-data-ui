import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

const ConfirmStep = (await import('./ConfirmStep.svelte')).default;

const summary = {
	toPair: 3,
	toSkip: 0,
	total: 3,
	warnings: 0,
	newSites: 1,
	newParams: 2,
	newProjects: 0,
};

// Every row ticked. A self-validated row is one nobody has looked at yet, and Apply waits for
// those too (Q155), so it is `acknowledged` that leaves the gate open.
const reviewProgress = {
	total: 3,
	needs_checking: 0,
	self_validated: 0,
	acknowledged: 3,
	needsCheckingPct: 0,
	selfValidatedPct: 0,
};

const noCreations = { projects: [], sites: [], parameters: [], groups: [] };

function mount(openInstrumentQuestions: number, over: Record<string, unknown> = {}) {
	return render(ConfirmStep, {
		props: {
			created: noCreations,
			onsiteattribute: vi.fn(),
			plan: { summary: { instruments_to_create: 1 } },
			summary,
			reviewProgress,
			familySummary: { streams: 0, columns: 0 },
			instruments: [],
			openInstrumentQuestions,
			undeclaredEstimatorCount: 0,
			undeclaredEstimatorFamilies: [],
			applying: false,
			applyJobId: null,
			onback: vi.fn(),
			onapply: vi.fn(),
			ongotoparam: vi.fn(),
			ongotoinstruments: vi.fn(),
			ongotosites: vi.fn(),
			...over,
		} as never,
	});
}

describe('ConfirmStep', () => {
	it('refuses Apply while an instrument is still undecided, and says why', () => {
		mount(1);
		const apply = screen.getByRole('button', { name: /Apply Plan/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		expect(screen.getByText(/instrument above first/i)).not.toBeNull();
	});

	it('offers Apply once every instrument is decided and every row is ticked', () => {
		mount(0);
		const apply = screen.getByRole('button', { name: /Apply Plan/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(false);
	});

	// The count and the wording are `applyGate.test.ts`; what this asserts is that the button
	// reflects the gate and that the operator is told why.
	it('refuses Apply while rows are still unticked, and says why', () => {
		mount(0, {
			reviewProgress: {
				total: 3,
				needs_checking: 3,
				self_validated: 0,
				acknowledged: 0,
				needsCheckingPct: 100,
				selfValidatedPct: 0,
			},
		});
		const apply = screen.getByRole('button', { name: /Apply Plan/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		expect(screen.getByText(/still to tick/)).not.toBeNull();
	});

	// A row that resolved cleanly is still a row nobody has looked at.
	it('refuses Apply while a row is only self-validated', () => {
		mount(0, {
			reviewProgress: {
				total: 3,
				needs_checking: 0,
				self_validated: 3,
				acknowledged: 0,
				needsCheckingPct: 0,
				selfValidatedPct: 100,
			},
		});
		const apply = screen.getByRole('button', { name: /Apply Plan/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
	});
});

describe('ConfirmStep creations', () => {
	const site = {
		name: 'WrongElevation',
		latitude: 46.25,
		longitude: 7.75,
		altitudeM: 1,
		anchorStreamId: 'stream-a',
		streamCount: 2,
	};

	it('lists the rows behind each count rather than only the number', () => {
		mount(0, {
			created: {
				projects: ['METALP'],
				sites: [site],
				parameters: [{ name: 'Depth', units: 'mm', siteCount: 2 }],
				groups: [{ code: 'field_data', label: 'Field data', members: ['WTW_pH_1', 'Field_BP'] }],
			},
			summary: { ...summary, newSites: 1, newParams: 1, newProjects: 1 },
		});
		expect(screen.getAllByText('METALP').length).toBeGreaterThan(0);
		expect(screen.getByText('Depth (mm)')).not.toBeNull();
		expect(screen.getByText('Field data · 2 parameters')).not.toBeNull();
	});

	it('reports an edited elevation against the site the apply has not created yet', async () => {
		const onsiteattribute = vi.fn();
		mount(0, {
			created: { ...noCreations, sites: [site] },
			summary: { ...summary, newSites: 1 },
			onsiteattribute,
		});
		const field = screen.getByLabelText('Elevation for WrongElevation') as HTMLInputElement;
		expect(field.value).toBe('1');
		await fireEvent.change(field, { target: { value: '2100' } });
		expect(onsiteattribute).toHaveBeenCalledWith(site, 'altitudeM', 2100);
	});

	it('reads a cleared field as no value rather than as zero', async () => {
		const onsiteattribute = vi.fn();
		mount(0, {
			created: { ...noCreations, sites: [site] },
			summary: { ...summary, newSites: 1 },
			onsiteattribute,
		});
		const field = screen.getByLabelText('latitude for WrongElevation');
		await fireEvent.change(field, { target: { value: '  ' } });
		expect(onsiteattribute).toHaveBeenCalledWith(site, 'latitude', null);
	});

	it('names the instruments the plan binds, whether or not the apply mints them', () => {
		mount(0, {
			instruments: [
				{
					name: 'Martigny CDOM',
					streamCount: 1,
					siteCount: 1,
					parameters: ['CDOM'],
					create: false,
					defaulted: true,
				},
				{
					name: 'DOC',
					streamCount: 31,
					siteCount: 23,
					parameters: ['DOC'],
					create: true,
					defaulted: false,
				},
			],
		});
		expect(screen.getByText('Instruments')).not.toBeNull();
		expect(screen.getByText(/Martigny CDOM/)).not.toBeNull();
		expect(screen.getByText(/named at registration/)).not.toBeNull();
		expect(screen.getByText(/created by this apply/)).not.toBeNull();
	});

	it('says nothing about instruments when the plan binds none', () => {
		mount(0);
		expect(screen.queryByText('Instruments')).toBeNull();
	});
});
