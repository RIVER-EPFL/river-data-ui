<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Parameter, type Project, type Site } from '$api/crud';
	import {
		getCalculationClosure,
		saveGrabSample,
		stageCollectionEvent,
		type CalculationImpact,
	} from '$api/service';
	import {
		batchParameters,
		batchVisits,
		inferLayout,
		layoutKey,
		parseBlock,
		saveAll,
		type BatchVisit,
		type ColumnRole,
		type Layout,
		type ParameterColumn,
	} from '$lib/visits/batch';
	import { editConsequence } from '$lib/visits/role';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// A field day pasted as one block (M51): rows are (site, collected_at), columns are parameter x
	// replicate. Each visit is staged and saved on its own, so a station the API refuses leaves the
	// stations already written alone.

	let projects = $state<Project[]>([]);
	let projectId = $state('');
	let sites = $state<Site[]>([]);
	let parameters = $state<ParameterColumn[]>([]);
	let block = $state<string[][]>([]);
	let pasted = $state('');
	let layout = $state<Layout>({ columns: [] });
	let error = $state('');
	let saving = $state(false);
	let confirmOpen = $state(false);
	let calculations = $state<CalculationImpact[]>([]);
	let consequence = $state<string | null>(null);
	/** What the save did to each row, in the block's order: the per-row result column. */
	let results = $state<Record<number, string>>({});

	const visits = $derived(batchVisits(block, layout, sites));
	const savable = $derived(visits.filter((v) => v.problem === null));
	const headers = $derived(block[0] ?? []);

	$effect(() => {
		api.projects
			.list({ perPage: 200, sort: ['name', 'ASC'] })
			.then((res) => {
				projects = res.data;
				if (!projectId && res.data.length > 0) projectId = res.data[0].id;
			})
			.catch((e) => (error = e instanceof Error ? e.message : String(e)));
	});

	$effect(() => {
		const id = projectId;
		if (!id) return;
		void loadProject(id);
	});

	async function loadProject(id: string) {
		try {
			const [siteRes, paramRes] = await Promise.all([
				api.sites.list({ perPage: 500, filter: { project_id: id }, sort: ['name', 'ASC'] }),
				api.parameters.list({ perPage: 1000, sort: ['code', 'ASC'] }),
			]);
			sites = siteRes.data;
			parameters = paramRes.data.map((p: Parameter) => ({
				parameterId: p.id,
				code: p.code,
				name: p.name,
			}));
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	/** The layout this project was last given, so a stable lab sheet is named once. */
	function storedLayout(columns: number): Layout | null {
		try {
			const raw = localStorage.getItem(layoutKey(projectId));
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Layout;
			return parsed.columns?.length === columns ? parsed : null;
		} catch {
			return null;
		}
	}

	function rememberLayout() {
		try {
			localStorage.setItem(layoutKey(projectId), JSON.stringify(layout));
		} catch {
			// A browser refusing storage costs the operator one naming, not the paste.
		}
	}

	function readBlock() {
		results = {};
		block = parseBlock(pasted);
		if (block.length === 0) {
			layout = { columns: [] };
			return;
		}
		layout = storedLayout(block[0].length) ?? inferLayout(block[0], parameters);
	}

	function setRole(column: number, value: string) {
		const columns = layout.columns.slice();
		if (value === 'site' || value === 'collected_at' || value === 'ignored') {
			columns[column] = { kind: value } as ColumnRole;
		} else {
			const [parameterId, index] = value.split('#');
			columns[column] = { kind: 'value', parameterId, replicateIndex: Number(index) };
		}
		layout = { columns };
	}

	function roleValue(role: ColumnRole): string {
		return role.kind === 'value' ? `${role.parameterId}#${role.replicateIndex}` : role.kind;
	}

	/** The replicate choices a parameter column offers, one wider than the widest pasted block. */
	const replicateChoices = $derived(
		Array.from({ length: Math.max(3, ...layout.columns.map((c) => (c.kind === 'value' ? c.replicateIndex + 2 : 0))) }, (_, i) => i),
	);

	async function askToSave() {
		calculations = [];
		consequence = null;
		const touched = batchParameters(visits);
		if (touched.length > 0) {
			try {
				const closure = await getCalculationClosure({ parameter_ids: touched.join(',') });
				calculations = closure.calculations;
				consequence = editConsequence(closure.calculations);
			} catch {
				consequence = null;
			}
		}
		confirmOpen = true;
	}

	async function saveVisit(visit: BatchVisit): Promise<string> {
		const staged = await stageCollectionEvent({
			site_id: visit.siteId!,
			collected_at: visit.collectedAt!,
		});
		await saveGrabSample({
			site_id: visit.siteId!,
			mode: 'replace',
			readings: visit.values.map((v) => ({
				parameter_id: v.parameterId,
				value: v.value,
				time: visit.collectedAt!,
				replicate_index: v.replicateIndex,
			})),
		});
		return staged.created ? 'saved, visit created' : 'saved into the standing visit';
	}

	async function save() {
		saving = true;
		confirmOpen = false;
		await saveAll(visits, saveVisit, (index, result) => {
			results = { ...results, [index]: result };
		});
		saving = false;
	}

	function parameterCode(id: string): string {
		return parameters.find((p) => p.parameterId === id)?.code ?? id;
	}
</script>

<svelte:head><title>Enter a field day | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="text-xl font-semibold">Enter a field day</h2>
		<a class="text-sm text-brand-primary hover:underline" href="{base}/events">Visits</a>
	</div>

	{#if error}<ErrorNotice message={error} />{/if}

	<div class="flex flex-wrap items-center gap-2 text-sm">
		<label for="project">Project</label>
		<select
			id="project"
			bind:value={projectId}
			class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1"
		>
			{#each projects as project (project.id)}
				<option value={project.id}>{project.name}</option>
			{/each}
		</select>
		<span class="text-brand-muted">The sites a row may name, and the layout it is remembered under.</span>
	</div>

	<div class="space-y-2">
		<label class="text-sm font-medium" for="block">Paste the sheet, header row included</label>
		<textarea
			id="block"
			bind:value={pasted}
			oninput={readBlock}
			rows="6"
			class="w-full rounded-md border border-brand-divider bg-brand-surface px-2 py-1 font-mono text-xs"
			placeholder="site&#9;date&#9;DOC_rep_1&#9;DOC_rep_2&#9;pH"
		></textarea>
		<p class="text-sm text-brand-muted">
			One row per station and date. A mean or standard deviation column is ignored: those are
			computed from the replicates rather than stored from a sheet.
		</p>
	</div>

	{#if headers.length > 0}
		<div class="space-y-2">
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="text-sm font-semibold">What each column holds</h3>
				<Button size="sm" onclick={rememberLayout}>Remember this layout</Button>
				<span class="text-sm text-brand-muted">
					Remembered in this browser for {projects.find((p) => p.id === projectId)?.name ?? 'the project'}.
				</span>
			</div>
			<div class="overflow-x-auto">
				<table class="min-w-full text-sm">
					<thead>
						<tr class="text-left text-xs uppercase tracking-wide text-gray-500">
							<th class="px-2 py-1">Column</th>
							<th class="px-2 py-1">Holds</th>
						</tr>
					</thead>
					<tbody>
						{#each headers as header, column (column)}
							<tr class="border-t border-gray-100 dark:border-gray-800">
								<th scope="row" class="px-2 py-1 text-left font-mono">{header || `column ${column + 1}`}</th>
								<td class="px-2 py-1">
									<select
										aria-label="What column {column + 1} holds"
										value={roleValue(layout.columns[column] ?? { kind: 'ignored' })}
										onchange={(e) => setRole(column, e.currentTarget.value)}
										class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1"
									>
										<option value="ignored">Ignored</option>
										<option value="site">Site</option>
										<option value="collected_at">Date</option>
										{#each parameters as parameter (parameter.parameterId)}
											{#each replicateChoices as index (index)}
												<option value="{parameter.parameterId}#{index}">
													{parameter.code} replicate {index + 1}
												</option>
											{/each}
										{/each}
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<div class="space-y-2">
			<h3 class="text-sm font-semibold">{visits.length} row{visits.length === 1 ? '' : 's'}, {savable.length} savable</h3>
			<div class="overflow-x-auto">
				<table class="min-w-full text-sm">
					<thead>
						<tr class="text-left text-xs uppercase tracking-wide text-gray-500">
							<th class="px-2 py-1">Site</th>
							<th class="px-2 py-1">Collected</th>
							<th class="px-2 py-1">Values</th>
							<th class="px-2 py-1">Result</th>
						</tr>
					</thead>
					<tbody>
						{#each visits as visit, index (index)}
							<tr class="border-t border-gray-100 dark:border-gray-800">
								<td class="px-2 py-1">{visit.site || '—'}</td>
								<td class="px-2 py-1">{visit.collectedAt ? formatDateTime(visit.collectedAt) : '—'}</td>
								<td class="px-2 py-1">
									{#if visit.values.length === 0}
										<span class="text-brand-muted">none</span>
									{:else}
										{visit.values
											.map((v) => `${parameterCode(v.parameterId)}[${v.replicateIndex + 1}] ${v.value}`)
											.join(', ')}
									{/if}
								</td>
								<td class="px-2 py-1 {visit.problem ? 'text-severity-alarm' : 'text-brand-muted'}">
									{results[index] ?? visit.problem ?? 'ready'}
									{#if !visit.problem && visit.unreadable > 0}
										<span class="text-brand-accent-dark"
											>({visit.unreadable}
											{visit.unreadable === 1 ? 'cell was not a number' : 'cells were not numbers'})</span
										>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<Button variant="primary" disabled={savable.length === 0 || saving} onclick={askToSave}>
			Save {savable.length} visit{savable.length === 1 ? '' : 's'}
		</Button>
	{/if}
</div>

<Dialog bind:open={confirmOpen} title="Save this field day">
	<div class="space-y-2 text-sm">
		<p>
			{savable.length} visit{savable.length === 1 ? '' : 's'} will be staged and saved, one at a
			time. A visit the API refuses leaves the visits already saved alone, and its row says why.
		</p>
		{#if consequence}
			<p class="text-brand-muted">{consequence}</p>
		{:else if calculations.length === 0}
			<p class="text-brand-muted">No calculation reads what this save writes.</p>
		{/if}
	</div>
	{#snippet actions()}
		<Button onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button variant="primary" loading={saving} onclick={save}>Save</Button>
	{/snippet}
</Dialog>
