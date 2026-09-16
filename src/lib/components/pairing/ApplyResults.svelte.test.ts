import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

const ApplyResults = (await import('./ApplyResults.svelte')).default;

// Exactly what the apply job stored on the plan, which is where the results are read from now
// that the wizard hands back instead of waiting.
const stored = {
	projects_created: 1,
	sites_created: 4,
	parameters_created: 23,
	site_parameters_created: 92,
	instruments_created: 6,
	streams_paired: 1891,
	readings_backfilled: 2_400_000,
	curves_assigned: 0,
	curves_created: 0,
	streams_skipped: 0,
	groups_created: 2,
	group_members_created: 17,
};

describe('ApplyResults', () => {
	it('renders the counts a finished apply recorded, with no job poll of its own', () => {
		render(ApplyResults, {
			props: { result: stored, ondone: vi.fn(), onrevert: vi.fn() },
		});
		expect(screen.getByText('Plan Applied')).not.toBeNull();
		expect(screen.getByText('Streams paired')).not.toBeNull();
		expect(screen.getByText('92')).not.toBeNull();
		expect(screen.getByText('23')).not.toBeNull();
		expect(screen.getByText('Parameter groups created')).not.toBeNull();
		expect(screen.getByText('2')).not.toBeNull();
	});

	it('says a revert is running rather than offering it twice', () => {
		render(ApplyResults, {
			props: { result: stored, reverting: true, ondone: vi.fn(), onrevert: vi.fn() },
		});
		const buttons = screen
			.getAllByRole('button', { name: 'Reverting…' })
			.filter((b) => (b as HTMLButtonElement).disabled);
		expect(buttons.length).toBeGreaterThan(0);
	});
});

// Scenario: an apply where an earlier plan had already paired some of the streams.
// Expected behaviour: the skip is on the screen the operator is handed, not only in the job
// detail, because a skipped stream is one the plan did not import.
describe('a partial apply', () => {
	it('reports the streams it skipped and the curves it assigned', () => {
		render(ApplyResults, {
			props: {
				result: { ...stored, streams_paired: 1591, streams_skipped: 300, curves_assigned: 14 },
				ondone: vi.fn(),
				onrevert: vi.fn(),
			},
		});
		expect(screen.getByText('Streams skipped')).not.toBeNull();
		expect(screen.getByText('300')).not.toBeNull();
		expect(screen.getByText('Standard curves assigned')).not.toBeNull();
		expect(screen.getByText('14')).not.toBeNull();
	});
});
