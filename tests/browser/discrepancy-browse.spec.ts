import { expect, test } from '@playwright/test';
import { BASE_PATH, signIn } from './portal';

// Scenario: a reading's point record links to the discrepancies recorded at its instant.
// Expected behaviour: the informational Review section opens narrowed to that reading, lists the
// tag with the source's statistics beside ours and a link back, and offers no review action.

const TAG = {
	id: '00000000-0000-4000-a000-00000000d001',
	stream_id: '00000000-0000-4000-a000-00000000d002',
	kind: 'replicate_stats',
	source_system: 'cnet',
	source_key: 'FP3:DOC_avg_ppb:reps',
	source_name: null,
	site_id: '00000000-0000-4000-a000-00000000d003',
	site_parameter_id: '00000000-0000-4000-a000-00000000d004',
	site_name: 'FP3',
	parameter_name: 'DOC',
	parameter_code: 'DOC',
	tool: null,
	paired: true,
	group_time: '2021-07-14T09:00:00Z',
	expected: { mean: 20, sd: 8.16, n: 4 },
	computed: { mean: 20.5, sd: 10, n: 3 },
	delta: { mean: -0.5, sd: -1.84 },
	status: 'deferred',
	classification: '',
	resolution: null,
	created_at: '2021-07-15T00:00:00Z',
	acknowledged_by: null,
	acknowledged_at: null,
	relative_delta: 0.2,
	mean_relative_delta: 0.02,
	sd_relative_delta: 0.2,
	awaiting_inputs: [],
};

test('the discrepancies at one reading are listed read-only with a link back to it', async ({ page }) => {
	const asked: URLSearchParams[] = [];
	await page.route(
		(url) => url.pathname.endsWith('/api/sync/replicate_audit_holds'),
		(route) => {
			const params = new URL(route.request().url()).searchParams;
			asked.push(params);
			const tags = params.get('status') === 'any';
			route.fulfill({
				json: { holds: tags ? [TAG] : [], total: tags ? 1 : 0, pending: 0, deferred: 0, pending_by_kind: {} },
			});
		},
	);
	await signIn(page);
	const query = new URLSearchParams({
		tab: 'discrepancies',
		tags_site: TAG.site_id,
		tags_parameter: '00000000-0000-4000-a000-00000000d005',
		tags_from: '2021-07-14T09:00:00.000Z',
		tags_to: '2021-07-14T09:00:00.001Z',
	});
	await page.goto(`${BASE_PATH}/streams?${query}`);

	await expect(page).toHaveURL(/tab=review/);
	await expect(page).toHaveURL(/review=discrepancies/);
	await expect(page.getByRole('button', { name: /^Review/ })).toHaveClass(/border-brand-primary/);
	await expect(page.getByRole('button', { name: 'Discrepancies (informational)' })).toHaveClass(
		/border-brand-primary/,
	);
	await expect(page.getByText('FP3 · DOC')).toBeVisible();
	await expect(page.getByText('mean 20, sd 8.16, n 4')).toBeVisible();
	await expect(page.getByText('mean 20.5, sd 10, n 3')).toBeVisible();
	await expect(page.getByText("One reading's instant")).toBeVisible();
	const tagQuery = asked.find((p) => p.get('status') === 'any')!;
	expect(tagQuery.get('site_id')).toBe(TAG.site_id);
	expect(tagQuery.get('from')).toBe('2021-07-14T09:00:00.000Z');
	expect(tagQuery.get('kind')).toBe('replicate_stats,curve_claim_stripped');

	const record = page.getByRole('link', { name: 'Point record' });
	await expect(record).toHaveAttribute('href', new RegExp(`/sites/${TAG.site_id}\\?point=${TAG.site_parameter_id}`));
	await expect(page.getByRole('button', { name: /acknowledge|mark reviewed|resolve/i })).toHaveCount(0);
});

test('legacy audit links open actionable review with its pending count and resolved hold', async ({
	page,
}) => {
	const asked: URLSearchParams[] = [];
	await page.route(
		(url) => url.pathname.endsWith('/api/sync/replicate_audit_holds'),
		(route) => {
			asked.push(new URL(route.request().url()).searchParams);
			route.fulfill({
				json: { holds: [], total: 0, pending: 3, deferred: 0, pending_by_kind: {} },
			});
		},
	);
	await page.route(
		(url) => url.pathname.endsWith('/api/reading_change_proposals'),
		(route) => route.fulfill({ headers: { 'content-range': 'items 0-0/2' }, json: [] }),
	);
	await signIn(page);
	await page.goto(`${BASE_PATH}/streams?tab=audits&holds_id=hold-1&view=resolved`);

	await expect(page).toHaveURL(/tab=review/);
	await expect(page).toHaveURL(/review=actionable/);
	await expect(page.getByRole('button', { name: 'Review (5)' })).toHaveClass(/border-brand-primary/);
	await expect(page.getByText('No resolved holds')).toBeVisible();
	await expect
		.poll(() => asked.some((p) => p.get('status') === 'resolved' && p.get('id') === 'hold-1'))
		.toBe(true);
});
