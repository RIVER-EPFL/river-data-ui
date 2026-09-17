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

const noCreations = { projects: [], sites: [], parameters: [], groups: [] };

function mount(blockedReason: string | null, over: Record<string, unknown> = {}) {
	return render(ConfirmStep, {
		props: {
			created: noCreations,
			onsiteattribute: vi.fn(),
			plan: { summary: { instruments_to_create: 1 } },
			summary,
			familySummary: { streams: 0, columns: 0 },
			instruments: [],
			blockedReason,
			applying: false,
			applyJobId: null,
			onback: vi.fn(),
			onapply: vi.fn(),
			...over,
		} as never,
	});
}

describe('ConfirmStep', () => {
	it('refuses Apply while a review tab is open, naming it on the button', () => {
		mount('Still to review: Sites (0 of 3 reviewed)');
		const apply = screen.getByRole('button', { name: /Apply Plan/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		expect(apply.title).toBe('Still to review: Sites (0 of 3 reviewed)');
	});

	it('offers Apply once every review tab is complete', () => {
		mount(null);
		const apply = screen.getByRole('button', { name: /Apply Plan/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(false);
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
		mount(null, {
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
		mount(null, {
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
		mount(null, {
			created: { ...noCreations, sites: [site] },
			summary: { ...summary, newSites: 1 },
			onsiteattribute,
		});
		const field = screen.getByLabelText('latitude for WrongElevation');
		await fireEvent.change(field, { target: { value: '  ' } });
		expect(onsiteattribute).toHaveBeenCalledWith(site, 'latitude', null);
	});

	it('names the instruments the plan binds, whether or not the apply mints them', () => {
		mount(null, {
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
		expect(screen.getByText(/named for its feed/)).not.toBeNull();
		expect(screen.getByText(/created by this apply/)).not.toBeNull();
	});

	it('says nothing about instruments when the plan binds none', () => {
		mount(null);
		expect(screen.queryByText('Instruments')).toBeNull();
	});
});

// Scenario: the CNET portal carries an elevation per station and no coordinates, so every site the
// apply creates from it lands with a null latitude and longitude.
//
// Expected behaviour: the confirm step says so before the apply, because a site is created once
// and the only route afterwards is the per-site edit form, one site at a time.
describe('ConfirmStep sites with no position', () => {
	const placed = {
		name: 'Martigny',
		latitude: 46.1,
		longitude: 7.07,
		altitudeM: 471,
		anchorStreamId: 'stream-a',
		streamCount: 2,
	};
	const unplaced = { ...placed, name: 'Saxon', latitude: null, longitude: null, anchorStreamId: 'stream-b' };

	it('counts the sites that would be created with no coordinates', () => {
		mount(null, {
			created: { ...noCreations, sites: [placed, unplaced] },
			summary: { ...summary, newSites: 2 },
		});
		expect(screen.getByText(/1 of the 2 sites .* no coordinates/i)).not.toBeNull();
	});

	it('says nothing when every site the apply creates has a position', () => {
		mount(null, {
			created: { ...noCreations, sites: [placed] },
			summary: { ...summary, newSites: 1 },
		});
		expect(screen.queryByText(/no coordinates/i)).toBeNull();
	});
});
