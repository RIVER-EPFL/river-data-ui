import { expect, test } from '@playwright/test';
import { API_URL, BASE_PATH, postGrab, signIn, token } from './portal';
import { seedComputedVisit } from './computedVisit';
import { frozenButton, frozenDate, sheetCell, typeInto } from './sheet';

// Scenario: a scientist corrects an input in the visits table and the calculation that reads it is
// queued by the save. The table is still open in front of them.
//
// Expected behaviour: the output cell holds the recomputed number without the page being reloaded.
// The chain runs as a tracked job, so the value arrives after the save's response, and a table that
// reads the visit once is showing the old number.

const ENTERED = 10;
const CORRECTED = 15;

test('a corrected input shows its recomputed output without a reload', async ({ page, request }) => {
	const { siteId, inputName, outputName } = await seedComputedVisit(request, 't102', ENTERED);
	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('1 visit', { exact: true })).toBeVisible();

	// The output has its own column, holding what the calculation wrote.
	const output = sheetCell(page, new RegExp(`^${outputName} at`));
	await expect(output).toHaveText(new RegExp(`^${ENTERED * 2}\\b`));

	// The input is corrected in place. The output's column is a calculation's, so it takes no
	// keystroke and stays a read-only cell.
	const cell = sheetCell(page, new RegExp(`^${inputName} at`));
	await expect(cell).toHaveText(String(ENTERED));
	await typeInto(page, new RegExp(`^${inputName} at`), String(CORRECTED));

	await page.getByRole('button', { name: 'Check against site history' }).click();
	const save = page.getByRole('button', { name: /^Save \d+ value/ });
	await save.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();

	// Nothing is reloaded: the table is the same page it was, with the recomputed output in it.
	await expect(cell).toHaveText(String(CORRECTED));
	await expect(output).toHaveText(new RegExp(`^${CORRECTED * 2}\\b`), { timeout: 30_000 });
});

// Scenario: a block pasted over two visits' stored inputs by mistake is saved, then recovered: one
// visit from the grid right after the save, the other from its value's history after a reload.
//
// Expected behaviour: each recovery names the value it puts back before it runs, restores only its
// own visit, and the calculated output at that visit follows the input back.

const EARLIER = 20;

test('a mistaken save over two visits is rolled back one visit at a time', async ({
	page,
	request,
}) => {
	const seeded = await seedComputedVisit(request, 'm281', ENTERED);
	const { siteId, inputId, inputName, outputName } = seeded;
	const headers = { Authorization: `Bearer ${await token(request)}` };
	const call = async (method: 'post' | 'get', path: string, data?: unknown) => {
		const response = await request[method](`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const earlierAt = new Date(Date.parse(seeded.collectedAt) - 86_400_000)
		.toISOString()
		.replace(/\.\d+Z$/, 'Z');
	await postGrab((path, data) => call('post', path, data), {
		site_id: siteId,
		mode: 'replace',
		readings: [{ parameter_id: inputId, value: EARLIER, time: earlierAt, replicate_index: 0 }],
	});
	const earlier = await call('post', '/collection_events/stage', {
		site_id: siteId,
		collected_at: earlierAt,
	});
	const servedAt = async (eventId: string) => {
		const detail = await call('get', `/collection_events/${eventId}/detail`);
		return (
			detail.cells.find((c: { parameter_code: string }) => c.parameter_code === outputName)
				?.served_value ?? null
		);
	};
	await expect.poll(() => servedAt(earlier.id), { timeout: 30_000 }).toBe(EARLIER * 2);

	await signIn(page);
	await page.goto(`${BASE_PATH}/sites/${siteId}?tab=visits`);
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();
	const inputs = sheetCell(page, new RegExp(`^${inputName} at`));
	const outputs = sheetCell(page, new RegExp(`^${outputName} at`));
	await expect(inputs.nth(0)).toHaveText(String(ENTERED));
	await expect(inputs.nth(1)).toHaveText(String(EARLIER));

	// The newest visit is the top row; the block runs down over the one under it.
	await inputs.nth(0).click();
	await page.evaluate((text) => {
		const data = new DataTransfer();
		data.setData('text/plain', text);
		(document.activeElement ?? document).dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
		);
	}, '15\n25');
	await page.getByRole('button', { name: 'Check against site history' }).click();
	await page.getByRole('button', { name: /^Save 2 values/ }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(outputs.nth(0)).toHaveText(/^30\b/, { timeout: 30_000 });
	await expect(outputs.nth(1)).toHaveText(/^50\b/, { timeout: 30_000 });

	// Right after the save, each visit it wrote over offers its own recovery.
	const recovery = page.locator('[data-save-recovery]');
	await recovery.getByRole('button', { name: /^Roll back the save at / }).first().click();
	await expect(dialog.locator('[data-rollback-lines]')).toHaveText(
		`${inputName} replicate 0: Measured 15 → ${ENTERED}`,
	);
	await dialog.getByRole('button', { name: 'Roll back', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(inputs.nth(0)).toHaveText(String(ENTERED));
	await expect(inputs.nth(1)).toHaveText('25');
	await expect.poll(() => servedAt(seeded.eventId), { timeout: 30_000 }).toBe(ENTERED * 2);
	// The earlier visit's own recompute from the save may land after the rollback's.
	await expect.poll(() => servedAt(earlier.id), { timeout: 30_000 }).toBe(50);

	// After a reload the save's own recovery is gone; the earlier visit's value still carries its
	// edit on its history, and rolls back from there.
	await page.reload();
	await expect(page.getByText('2 visits', { exact: true })).toBeVisible();
	await expect(inputs.nth(0)).toHaveText(String(ENTERED));
	await expect(outputs.nth(0)).toHaveText(new RegExp(`^${ENTERED * 2}\\b`));
	await expect(inputs.nth(1)).toHaveText('25');
	await expect(page.locator('[data-save-recovery]')).toHaveCount(0);

	await frozenButton(page, { name: frozenDate(earlierAt) }).click();
	await page.getByRole('button', { name: inputName, exact: true }).click();
	// The record and its history fit the panel's width: nothing scrolls sideways.
	const record = page.getByTestId('point-record');
	await expect(record.getByRole('button', { name: 'Roll back this reading' }).first()).toBeVisible();
	const overflow = await record.evaluate((el) =>
		[el, ...el.querySelectorAll('*')]
			.filter((node) => node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX !== 'visible' && getComputedStyle(node).overflowX !== 'hidden')
			.map((node) => `${node.tagName}.${node.className} ${node.scrollWidth}/${node.clientWidth}`),
	);
	expect(overflow).toEqual([]);
	await page.getByRole('button', { name: 'Roll back this reading' }).first().click();
	await expect(dialog.locator('[data-rollback-lines]')).toHaveText(
		`${inputName} replicate 0: Measured 25 → ${EARLIER}`,
	);
	await dialog.getByRole('button', { name: 'Roll back', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => servedAt(earlier.id), { timeout: 30_000 }).toBe(EARLIER * 2);
	await page.reload();
	await expect(inputs.nth(1)).toHaveText(String(EARLIER));
	await expect(outputs.nth(1)).toHaveText(new RegExp(`^${EARLIER * 2}\\b`));
});
