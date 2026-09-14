<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Constant, type DerivedParameter, type Parameter } from '$api/crud';
	import {
		draftRunFormulas,
		getStepDependents,
		getToolScript,
		listSiteVisits,
		type FormulaDraftRunResponse,
		type StepDependents,
		type ToolScriptDetail,
		type VisitRow,
	} from '$api/service';
	import { listAll } from '$api/paged';
	import {
		blankFormula,
		dependencyOrder,
		draftOutputs,
		draftRunBody,
		editableFormula,
		formulaBody,
		inputRows,
		outputRows,
		type EditableFormula,
	} from '$lib/calculations/editor';
	import { perReplicateChoices } from '$lib/derivedParameters';
	import { identifiers } from '$lib/formula/lint';
	import { runTables } from '$lib/tools/runTable';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import VisualFormulaBuilder from '$components/formula/VisualFormulaBuilder.svelte';
	import RunResultsTable from '$components/tools/RunResultsTable.svelte';
	import type { Diagnostic } from '$lib/formula/lint';

	// A calculation whole: what it reads on the left, its formulas in order in the middle, what
	// it publishes on the right, and below them a run of the set as it stands at a real visit.
	// Nothing on the page is specific to one calculation.

	const calculationId = page.params.id!;

	let calculation = $state<ToolScriptDetail | null>(null);
	let stored = $state<EditableFormula[]>([]);
	let formulas = $state<EditableFormula[]>([]);
	let parameters = $state<Parameter[]>([]);
	let constants = $state<Constant[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);

	let editing = $state<number | null>(null);
	let diagnostics = $state<Diagnostic[]>([]);

	let siteId = $state('');
	let visits = $state<VisitRow[]>([]);
	let visitId = $state('');
	let visitsLoading = $state(false);
	let replicateText = $state<Record<string, string>>({});
	let running = $state(false);
	let run = $state<FormulaDraftRunResponse | null>(null);
	let runError = $state('');

	// Steps this calculation reads but does not own (Q156), and the ones it could bring in.
	let shareable = $state<DerivedParameter[]>([]);
	let declaring = $state('');
	let dependents = $state<Record<string, StepDependents>>({});
	let expanded = $state<string | null>(null);

	const ordered = $derived(dependencyOrder(formulas));
	const inputs = $derived(inputRows(formulas, parameters, constants));
	const outputs = $derived(outputRows(formulas));
	const families = $derived(inputs.filter((i) => i.kind === 'replicates').map((i) => i.name));
	const unsaved = $derived(formulas.some((f) => f.id === null || isDirty(f)));
	const visit = $derived(visits.find((v) => v.id === visitId) ?? null);
	const paramVars = $derived(
		parameters
			.filter((p) => p.category !== 'device_health')
			.map((p) => ({
				name: p.code,
				label: `${p.name}${p.default_units ? ' (' + p.default_units + ')' : ''}`,
				category: p.category,
			})),
	);
	const tables = $derived(
		run?.ran
			? runTables(run.results ?? {}, draftOutputs(run.manifest), run.skipped ?? [], run.trace ?? [])
			: null,
	);

	function isDirty(f: EditableFormula): boolean {
		const was = stored.find((s) => s.id === f.id);
		return !was || JSON.stringify(was) !== JSON.stringify(f);
	}

	function variableNames(f: EditableFormula): string[] {
		return [...new Set(identifiers(f.formula).map((i) => i.name))];
	}

	/** The codes a formula may read as steps: every other formula of the set, in order. */
	function stepsBefore(f: EditableFormula): string[] {
		return ordered
			.filter((o) => o !== f && o.code.trim())
			.map((o) => o.code.trim());
	}

	/** The steps this calculation reads through a declaration, as read-only rows of the list. */
	async function declaredSteps(steps: DerivedParameter[]): Promise<EditableFormula[]> {
		const declarations = await api.calculationSharedSteps.list({
			perPage: 200,
			filter: { tool_script_id: calculationId },
		});
		const rows: EditableFormula[] = [];
		for (const declaration of declarations.data) {
			const step = steps.find((s) => s.id === declaration.formula_id);
			if (step) rows.push({ ...editableFormula(step), declarationId: declaration.id });
		}
		return rows;
	}

	async function declare() {
		if (!declaring) return;
		busy = true;
		try {
			await api.calculationSharedSteps.create({
				tool_script_id: calculationId,
				formula_id: declaring,
			});
			declaring = '';
			await load();
			toastStore.success('Step brought in');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not bring the step in');
		} finally {
			busy = false;
		}
	}

	async function stopReading(f: EditableFormula) {
		if (!f.declarationId) return;
		busy = true;
		try {
			await api.calculationSharedSteps.remove(f.declarationId);
			await load();
			toastStore.success('Step no longer read here');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not drop the step');
		} finally {
			busy = false;
		}
	}

	async function showDependents(f: EditableFormula) {
		if (!f.id) return;
		expanded = expanded === f.id ? null : f.id;
		if (expanded && !dependents[f.id]) {
			try {
				dependents = { ...dependents, [f.id]: await getStepDependents(f.id) };
			} catch (e) {
				toastStore.error(e instanceof Error ? e.message : 'Could not read what the step feeds');
			}
		}
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const [script, rows, params, consts, steps] = await Promise.all([
				getToolScript(calculationId),
				api.derivedParameters.list({
					perPage: 500,
					filter: { tool_script_id: calculationId },
					sort: ['ordinal', 'ASC'],
				}),
				listAll<Parameter>(api.parameters, { perPage: 500, sort: ['code', 'ASC'] }),
				listAll<Constant>(api.constants, { perPage: 500, sort: ['name', 'ASC'] }),
				listAll<DerivedParameter>(api.derivedParameters, {
					perPage: 500,
					filter: { intermediate: true },
					sort: ['code', 'ASC'],
				}),
			]);
			calculation = script;
			const declared = await declaredSteps(steps);
			stored = [...rows.data.map(editableFormula), ...declared];
			formulas = [...rows.data.map(editableFormula), ...declared];
			parameters = params;
			constants = consts;
			// A step this calculation already reads, or already owns, is not one to bring in.
			const own = new Set(stored.map((f) => f.id));
			shareable = steps.filter((s) => !own.has(s.id));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the calculation';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function add() {
		formulas = [...formulas, blankFormula(formulas)];
		editing = formulas.length - 1;
	}

	async function save(f: EditableFormula) {
		if (!f.code.trim() || !f.formula.trim() || diagnostics.length > 0) return;
		busy = true;
		try {
			const body = formulaBody(f, calculationId);
			const saved = f.id
				? await api.derivedParameters.update(f.id, body)
				: await api.derivedParameters.create(body);
			const row = editableFormula(saved);
			formulas = formulas.map((x) => (x === f ? row : x));
			stored = [...stored.filter((s) => s.id !== row.id), row];
			editing = null;
			toastStore.success(f.id ? 'Formula saved' : 'Formula added');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			busy = false;
		}
	}

	function discard(f: EditableFormula) {
		const was = stored.find((s) => s.id === f.id);
		formulas = was ? formulas.map((x) => (x === f ? { ...was } : x)) : formulas.filter((x) => x !== f);
		editing = null;
	}

	async function remove(f: EditableFormula) {
		if (!f.id) {
			discard(f);
			return;
		}
		busy = true;
		try {
			await api.derivedParameters.remove(f.id);
			formulas = formulas.filter((x) => x !== f);
			stored = stored.filter((s) => s.id !== f.id);
			editing = null;
			toastStore.success('Formula removed');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Remove failed');
		} finally {
			busy = false;
		}
	}

	async function loadVisits(site: string) {
		visits = [];
		visitId = '';
		run = null;
		if (!site) return;
		visitsLoading = true;
		try {
			const res = await listSiteVisits(site, { page_size: 50 });
			visits = res.visits;
		} catch (e) {
			runError = e instanceof Error ? e.message : 'Failed to load visits';
		} finally {
			visitsLoading = false;
		}
	}

	async function runAtVisit() {
		if (!visit) return;
		running = true;
		runError = '';
		try {
			run = await draftRunFormulas(
				calculationId,
				draftRunBody(formulas, { siteId, collectedAt: visit.collected_at }, replicateText),
			);
		} catch (e) {
			run = null;
			runError = e instanceof Error ? e.message : 'The run was refused';
		} finally {
			running = false;
		}
	}

	const kindLabel: Record<string, string> = {
		replicates: 'family',
		parameter: 'parameter',
		constant: 'constant',
		step: 'step',
		curve: 'curve',
		other: 'site property',
	};
	const inputCls =
		'w-full px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface text-brand-text';
</script>

<svelte:head>
	<title>{calculation ? calculation.label || calculation.name : 'Calculation'} - River Data</title>
</svelte:head>

<div class="space-y-4">
	<div>
		<Breadcrumbs items={[{ label: 'Toolbox', href: `${base}/toolbox` }, { label: calculation?.label || calculation?.name || 'Calculation' }]} />
		<div class="flex items-start justify-between gap-3 flex-wrap">
			<div>
				<h2 class="text-xl font-semibold">{calculation?.label || calculation?.name || 'Calculation'}</h2>
				{#if calculation}
					<p class="text-sm text-brand-muted">
						{calculation.name} · formula calculation
						{#if calculation.active_version_no}· version {calculation.active_version_no}{/if}
						{#if !calculation.enabled}· <Badge variant="warning">disabled</Badge>{/if}
					</p>
					{#if calculation.description}<p class="text-sm text-brand-muted mt-1">{calculation.description}</p>{/if}
				{/if}
			</div>
			{#if calculation?.parameter_group_id}
				<a href="{base}/parameters/groups/{calculation.parameter_group_id}" class="text-sm text-brand-primary no-underline hover:underline">Parameter group</a>
			{/if}
		</div>
	</div>

	{#if error}
		<ErrorNotice message={error} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		<div class="grid grid-cols-1 xl:grid-cols-[minmax(220px,1fr)_minmax(420px,2fr)_minmax(220px,1fr)] gap-4 items-start">
			<!-- Inputs: everything the set reads, and how a run supplies it. -->
			<section class="rounded-md border border-brand-divider bg-brand-surface">
				<h3 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">Inputs</h3>
				{#if inputs.length === 0}
					<p class="px-3 py-3 text-sm text-brand-muted">Nothing read yet.</p>
				{:else}
					<ul class="divide-y divide-brand-divider">
						{#each inputs as input (input.name)}
							<li class="px-3 py-2 text-sm">
								<div class="flex items-center justify-between gap-2">
									<span class="font-mono">{input.name}</span>
									<Badge variant={input.kind === 'replicates' ? 'accent' : 'default'}>{kindLabel[input.kind]}</Badge>
								</div>
								<p class="text-xs text-brand-muted">
									{input.detail}
									{#if input.kind === 'replicates'}· one value per replicate, A, B, …{/if}
								</p>
								<p class="text-xs text-brand-muted">read by {input.readBy.join(', ') || '—'}</p>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Formulas, in evaluation order, edited in place. -->
			<section class="rounded-md border border-brand-divider bg-brand-surface">
				<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-brand-divider">
					<h3 class="text-sm font-semibold">Formulas</h3>
					<div class="flex flex-wrap items-center gap-2">
						{#if shareable.length > 0}
							<select bind:value={declaring} class={inputCls} aria-label="A step written elsewhere">
								<option value="">Bring in a step…</option>
								{#each shareable as step (step.id)}
									<option value={step.id}>{step.code}{step.name && step.name !== step.code ? ` · ${step.name}` : ''}</option>
								{/each}
							</select>
							<Button size="sm" disabled={busy || !declaring} onclick={declare}>Bring in</Button>
						{/if}
						<Button size="sm" onclick={add} disabled={busy || editing !== null}>Add formula</Button>
					</div>
				</div>
				<p class="px-3 pt-2 text-xs text-brand-muted">In the order the dependencies give them: a formula comes after every formula whose code it reads.</p>
				{#if ordered.length === 0}
					<p class="px-3 py-3 text-sm text-brand-muted">No formulas yet. Add the first; a per-replicate formula runs once per index of the family it names.</p>
				{/if}
				<ol class="divide-y divide-brand-divider">
					{#each ordered as f, index (f.id ?? `new-${index}`)}
						{@const position = formulas.indexOf(f)}
						<li class="px-3 py-2">
							{#if editing === position}
								<div class="space-y-2">
									<div class="grid grid-cols-3 gap-2">
										<label class="text-xs text-brand-muted">Code
											<input bind:value={f.code} placeholder="CO2_HS_Um" class={inputCls} />
										</label>
										<label class="text-xs text-brand-muted">Name
											<input bind:value={f.name} placeholder="CO2 headspace" class={inputCls} />
										</label>
										<label class="text-xs text-brand-muted">Units
											<input bind:value={f.units} placeholder="uM" class={inputCls} />
										</label>
									</div>
									<VisualFormulaBuilder
										bind:value={f.formula}
										bind:diagnostics
										variables={paramVars}
										{constants}
										steps={stepsBefore(f)}
										hasCurve={f.curve_slot.trim().length > 0}
										ownCode={f.code || undefined}
									/>
									<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
										<label class="text-xs text-brand-muted">Per replicate over
											<select bind:value={f.per_replicate} class={inputCls}>
												<option value="">Not per replicate, one value per visit</option>
												{#each perReplicateChoices(variableNames(f)) as variable (variable)}
													<option value={variable}>{variable}</option>
												{/each}
												{#if f.per_replicate && !variableNames(f).includes(f.per_replicate)}
													<option value={f.per_replicate}>{f.per_replicate} (not in the formula)</option>
												{/if}
											</select>
										</label>
										<label class="text-xs text-brand-muted">Curve slot
											<input bind:value={f.curve_slot} placeholder="doc" class={inputCls} />
										</label>
										<label class="flex items-start gap-2 text-sm md:col-span-2">
											<input type="checkbox" bind:checked={f.intermediate} class="mt-1" />
											<span>A step of the calculation
												<span class="block text-xs text-brand-muted">Handed to the formulas after it under its code, stored nowhere.</span>
											</span>
										</label>
									</div>
									<div class="flex gap-2">
										<Button size="sm" variant="primary" loading={busy} disabled={!f.code.trim() || !f.formula.trim() || diagnostics.length > 0} onclick={() => save(f)}>{f.id ? 'Save' : 'Add'}</Button>
										<Button size="sm" variant="ghost" disabled={busy} onclick={() => discard(f)}>Cancel</Button>
									</div>
								</div>
							{:else}
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="text-sm">
											<span class="text-brand-muted">{index + 1}.</span>
											<span class="font-mono">{f.code || '(no code)'}</span>
											{#if f.name && f.name !== f.code}<span class="text-brand-muted"> · {f.name}</span>{/if}
											{#if f.units}<span class="text-brand-muted"> ({f.units})</span>{/if}
											{#if f.per_replicate}<Badge variant="accent">per {f.per_replicate}</Badge>{/if}
											{#if f.intermediate}<Badge>step</Badge>{/if}
											{#if f.declarationId}<Badge variant="accent">shared</Badge>{/if}
											{#if f.curve_slot}<Badge>curve {f.curve_slot}</Badge>{/if}
											{#if f.id === null || isDirty(f)}<Badge variant="warning">unsaved</Badge>{/if}
										</p>
										<p class="font-mono text-xs text-brand-muted break-all">{f.formula || '—'}</p>
										{#if f.declarationId && f.id && expanded === f.id}
											{@const feeds = dependents[f.id]}
											<div class="mt-1 rounded-md border border-brand-divider bg-brand-bg px-2 py-1">
												{#if feeds}
													<p class="text-xs text-brand-muted">Read by</p>
													<ul class="text-xs">
														{#each feeds.calculations as reader (reader.tool_script_id)}
															<li>
																<a href="{base}/calculations/{reader.tool_script_id}" class="text-brand-primary no-underline hover:underline">{reader.label || reader.name}</a>
																<span class="text-brand-muted">
																	{reader.formulas.map((r) => r.code).join(', ') || 'no formula names it yet'}
																</span>
															</li>
														{/each}
													</ul>
												{:else}
													<p class="text-xs text-brand-muted">Reading…</p>
												{/if}
											</div>
										{/if}
									</div>
									<div class="whitespace-nowrap">
										{#if f.declarationId}
											<Button size="sm" variant="ghost" disabled={busy} onclick={() => showDependents(f)}>{expanded === f.id ? 'Hide' : 'What it feeds'}</Button>
											<ConfirmPopover message="Stop reading {f.code} in this calculation? The step itself stays." confirmLabel="Stop reading" onconfirm={() => stopReading(f)}>
												<Button size="sm" variant="ghost" disabled={busy}>Stop reading</Button>
											</ConfirmPopover>
										{:else}
											<Button size="sm" variant="ghost" disabled={busy || editing !== null} onclick={() => { diagnostics = []; editing = position; }}>Edit</Button>
											<ConfirmPopover message="Remove {f.code || 'this formula'} from the calculation?" confirmLabel="Remove" onconfirm={() => remove(f)}>
												<Button size="sm" variant="ghost" disabled={busy}>Remove</Button>
											</ConfirmPopover>
										{/if}
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</section>

			<!-- Outputs: what a run publishes, in order. -->
			<section class="rounded-md border border-brand-divider bg-brand-surface">
				<h3 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">Outputs</h3>
				{#if outputs.length === 0}
					<p class="px-3 py-3 text-sm text-brand-muted">Nothing published yet.</p>
				{:else}
					<ul class="divide-y divide-brand-divider">
						{#each outputs as output (output.code)}
							<li class="px-3 py-2 text-sm">
								<div class="flex items-center justify-between gap-2">
									<span class="font-mono">{output.code}</span>
									{#if output.perReplicate}<Badge variant="accent">A, B, …</Badge>{/if}
								</div>
								<p class="text-xs text-brand-muted">{output.label}{output.units ? ` (${output.units})` : ''}{output.perReplicate ? ' · one reading per replicate; mean and sd derived' : ''}</p>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<!-- Run at a visit: the set as it stands, saved or not, against stored values. -->
		<section class="rounded-md border border-brand-divider bg-brand-surface">
			<div class="px-3 py-2 border-b border-brand-divider">
				<h3 class="text-sm font-semibold">Run at a visit</h3>
				<p class="text-xs text-brand-muted">Evaluates the formulas as they stand{unsaved ? ', unsaved edits included' : ''}, reading the visit's stored values. Nothing is written.</p>
			</div>
			<div class="px-3 py-3 space-y-3">
				<div class="flex flex-wrap items-end gap-2">
					<label class="text-xs text-brand-muted">Site
						<SiteSelect bind:value={siteId} class="block mt-0.5 {inputCls}" onchange={(s) => loadVisits(s)} />
					</label>
					<label class="text-xs text-brand-muted">Visit
						<select bind:value={visitId} disabled={!siteId || visitsLoading} class="block mt-0.5 {inputCls} min-w-56">
							<option value="">{visitsLoading ? 'Loading…' : visits.length === 0 ? 'No visits' : 'Choose a visit…'}</option>
							{#each visits as v (v.id)}
								<option value={v.id}>{formatDateTime(v.collected_at)} · {v.parameters_filled} filled</option>
							{/each}
						</select>
					</label>
					{#each families as family (family)}
						<label class="text-xs text-brand-muted">{family} (A, B, …)
							<input bind:value={replicateText[family]} placeholder="410, 415" class="block mt-0.5 {inputCls} w-40" />
						</label>
					{/each}
					<Button size="sm" variant="primary" loading={running} disabled={!visit || ordered.length === 0} onclick={runAtVisit}>Run</Button>
				</div>
				{#if runError}<ErrorNotice message={runError} />{/if}
				{#if run && !run.ran && run.failure}
					<ErrorNotice message={run.failure.message} />
				{/if}
				{#if run?.ran}
					{#if (run.event_inputs?.length ?? 0) + (run.site_inputs?.length ?? 0) > 0}
						<p class="text-xs text-brand-muted">
							Read from the visit:
							{#each run.event_inputs ?? [] as e (e.param)}
								<span class="font-mono">{e.param}</span> = {e.value ?? '—'}{' '}
							{/each}
							{#each run.site_inputs ?? [] as s (s.param)}
								<span class="font-mono">{s.param}</span> = {s.value ?? '—'} (site){' '}
							{/each}
						</p>
					{/if}
					{#if tables}<RunResultsTable {tables} />{/if}
					{#if (run.skipped?.length ?? 0) > 0}
						<ul class="text-xs text-brand-muted">
							{#each run.skipped ?? [] as s, i (i)}
								<li><span class="font-mono">{s.output}</span> not run: {s.reason}</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		</section>
	{/if}
</div>
