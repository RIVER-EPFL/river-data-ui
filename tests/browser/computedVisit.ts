import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL, postGrab, saveFormulaSet, token } from './portal';

// A site of its own holding one visit: one entered value and one output a formula calculation
// writes from it. Two stories start here, the one that corrects the input and the one that previews
// the correction, so the seeding is shared rather than written twice.

export interface ComputedVisit {
	siteId: string;
	eventId: string;
	inputId: string;
	inputName: string;
	outputName: string;
	collectedAt: string;
	/** The served value of the calculation's output at this visit, read back from the API. */
	served: () => Promise<number | null>;
}

export async function seedComputedVisit(
	request: APIRequestContext,
	prefix: string,
	entered: number,
): Promise<ComputedVisit> {
	const stamp = `${Date.now()}`;
	const bearer = await token(request);
	const headers = { Authorization: `Bearer ${bearer}` };
	const call = async (method: 'post' | 'get', path: string, data?: unknown) => {
		const response = await request[method](`${API_URL}/api${path}`, { headers, data });
		expect(response.ok(), `${path} -> ${response.status()} ${await response.text()}`).toBeTruthy();
		return response.json();
	};
	const post = (path: string, data: unknown) => call('post', path, data);

	const inputName = `${prefix}_in_${stamp}`;
	const outputName = `${prefix}_out_${stamp}`;
	const project = await post('/projects', { name: `${prefix} ${stamp}` });
	const site = await post('/sites', { name: `${prefix} ${stamp}`, project_id: project.id });
	const group = await post('/parameter_groups', {
		code: `${prefix}_${stamp}`,
		label: `${prefix} ${stamp}`,
		ordinal: 1,
	});

	// The calculation mints its own output parameter (Q183), so only the input is declared here.
	const declare = async (parameterId: string, code: string, role: string, ordinal: number) => {
		await post('/parameter_group_members', {
			group_id: group.id,
			parameter_id: parameterId,
			role,
			ordinal,
		});
		// The visit arm: a slot left at the column default is the stream engine's, and the chain
		// skips an output it holds.
		await post('/site_parameters', {
			site_id: site.id,
			parameter_id: parameterId,
			name: code,
			cadence: 'low',
		});
	};
	const input = await post('/parameters', {
		code: inputName,
		name: inputName,
		category: 'measurement',
		aliases: [],
	});
	await declare(input.id, inputName, 'measured', 0);

	const calculation = await post('/tool_scripts', {
		name: `${prefix}_${stamp}`,
		label: `${prefix} ${stamp}`,
		engine: 'formula',
		parameter_group_id: group.id,
	});
	const derived = await saveFormulaSet(request, headers, calculation.id, {
		code: outputName,
		name: outputName,
		units: '',
		formula: `${inputName} * 2`,
		ordinal: 1,
	});
	await declare(derived.output_parameter_id, outputName, 'output', 1);

	const collectedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
	await postGrab(post, {
		site_id: site.id,
		mode: 'replace',
		readings: [{ parameter_id: input.id, value: entered, time: collectedAt, replicate_index: 0 }],
	});
	const staged = await post('/collection_events/stage', {
		site_id: site.id,
		collected_at: collectedAt,
	});

	const served = async () => {
		const detail = await call('get', `/collection_events/${staged.id}/detail`);
		const output = detail.cells.find(
			(c: { parameter_code: string }) => c.parameter_code === outputName,
		);
		return output?.served_value ?? null;
	};

	// The save queued the chain; a story starts from a settled visit, so wait for the first run.
	await expect
		.poll(served, {
			message: 'the calculation writes its output at the seeded visit',
			timeout: 30_000,
		})
		.toBe(entered * 2);

	return {
		siteId: site.id,
		eventId: staged.id,
		inputId: input.id,
		inputName,
		outputName,
		collectedAt,
		served,
	};
}
