<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		api,
		type Constant,
		type DerivedParameter,
		type Parameter,
		type ParameterGroupMember,
	} from '$api/crud';
	import {
		draftRunFormulas,
		getStepDependents,
		getToolScript,
		listSiteVisits,
		listToolVersionUsage,
		saveFormulaSet,
		type FormulaDraftRunResponse,
		type StepDependents,
		type ToolScriptDetail,
		type ToolVersionUsage,
		type VisitRow,
	} from '$api/service';
	import { listAll } from '$api/paged';
	import {
		blankFormula,
		dependencyOrder,
		draftOutputs,
		curveSlots,
		draftRunBody,
		editableFormula,
		formulaSetBody,
		formulaVariables,
		inputRows,
		outputRows,
		scalarInputs,
		scalarOverrides,
		type EditableFormula,
	} from '$lib/calculations/editor';
	import { armConsequence, storedLabel } from '$lib/calculations/consequence';
	import { portalReference, replicatedCodes } from '$lib/calculations/members';
	import { perReplicateChoices } from '$lib/derivedParameters';
	import { identifiers } from '$lib/formula/lint';
	import { curveField } from '$lib/tools/form';
	import { runInputTables, runTables } from '$lib/tools/runTable';
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
	import CurvePicker, { emptyCurveSelection, type CurveSelection } from '$components/tools/CurvePicker.svelte';
	import type { Diagnostic } from '$lib/formula/lint';
	import { AUTHORING_REFUSED } from '$lib/toolbox/authoring';
	import { ApiError } from '$api/client';

	// A calculation whole: what it reads on the left, its formulas in order in the middle, what
	// it publishes on the right, and below them a run of the set as it stands at a real visit.
	// Nothing on the page is specific to one calculation.

	let { calculationId }: { calculationId: string } = $props();

	let calculation = $state<ToolScriptDetail | null>(null);
	// What each version has already produced, so the save says what it moves before it is made.
	let usage = $state<ToolVersionUsage[]>([]);
	let stored = $state<EditableFormula[]>([]);
	let formulas = $state<EditableFormula[]>([]);
	let parameters = $state<Parameter[]>([]);
	let constants = $state<Constant[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);

	let editing = $state<number | null>(null);
	let diagnostics = $state<Diagnostic[]>([]);

	let siteId = $state(page.url.searchParams.get('site') ?? '');
	let visits = $state<VisitRow[]>([]);
	let visitId = $state(page.url.searchParams.get('visit') ?? '');
	let visitsLoading = $state(false);
	let replicateText = $state<Record<string, string>>({});
	// A number typed in place of what the visit or the catalog holds, so a set can be checked
	// against its golden figures before any visit carries them. Blank reads the stored value.
	let scalarText = $state<Record<string, string>>({});
	// One selection per declared curve slot: what binds `curve_slope` and `curve_intercept` for
	// the run. Unbound, the slot's formulas are skipped for want of coefficients.
	let curveChoice = $state<Record<string, CurveSelection>>({});
	let running = $state(false);
	let run = $state<FormulaDraftRunResponse | null>(null);
	let runError = $state('');

	// The group memberships of the catalog: what a parameter is entered several times as, and what
	// the source computed it with. A calculation names no group (Q169), so both are read per
	// parameter, for the parameters this set reads and writes.
	let members = $state<ParameterGroupMember[]>([]);

	// Steps this calculation reads but does not own (Q156), and the ones it could bring in.
	let shareable = $state<DerivedParameter[]>([]);
	let declaring = $state('');
	let dependents = $state<Record<string, StepDependents>>({});
	let expanded = $state<string | null>(null);

	const usageByVersion = $derived(new Map(usage.map((u) => [u.version_id, u])));
	const activeUsage = $derived(usage.find((u) => u.version_no === calculation?.active_version_no));
	// Nothing to leave behind or recompute until a version has been serving: the first save
	// supersedes none.
	const supersedes = $derived(calculation?.active_version_no != null);
	const ordered = $derived(dependencyOrder(formulas));
	// A source of a replicated parameter that a per-replicate formula walks is the family, not its
	// mean (Q155); replicate-ness is the parameter's, in whichever group holds it.
	const replicated = $derived(replicatedCodes(members, parameters));
	const inputs = $derived(inputRows(formulas, parameters, constants, replicated));
	const outputs = $derived(outputRows(formulas));
	const families = $derived(inputs.filter((i) => i.kind === 'replicates').map((i) => i.name));
	const scalars = $derived(scalarInputs(inputs));
	// What the last run read for each scalar, shown as the box's placeholder so a blank box says
	// which number it stands for.
	const resolved = $derived(
		Object.fromEntries(
			[...(run?.event_inputs ?? []), ...(run?.site_inputs ?? [])]
				.filter((i) => i.value !== null && i.value !== undefined)
				.map((i) => [i.param, String(i.value)]),
		) as Record<string, string>,
	);
	const slots = $derived(curveSlots(formulas));
	// A formula added, edited, or dropped from the set: all three are the save's business.
	const dropped = $derived(
		stored.filter((s) => !s.declarationId && !formulas.some((f) => f.id === s.id)),
	);
	const unsaved = $derived(
		formulas.some((f) => f.id === null || isDirty(f)) || dropped.length > 0,
	);
	const visit = $derived(visits.find((v) => v.id === visitId) ?? null);
	const paramVars = $derived(formulaVariables(parameters));
	const tables = $derived(
		run?.ran
			? runTables(run.results ?? {}, draftOutputs(run.manifest), run.skipped ?? [], run.trace ?? [])
			: null,
	);
	// What the run was given, in the same table shape: the visit's own values, then the numbers
	// that are the same at every visit.
	const given = $derived(
		run?.ran
			? runInputTables(
					run.event_inputs ?? [],
					run.site_inputs ?? [],
					run.constants ?? {},
					(run.curves ?? []) as Parameters<typeof runInputTables>[3],
				)
			: undefined,
	);

	// The codes this set names: what its formulas read, and what they publish.
	const namedCodes = $derived([
		...new Set([
			...inputs.filter((i) => i.kind === 'parameter' || i.kind === 'replicates').map((i) => i.name),
			...formulas.map((f) => f.code.trim()).filter(Boolean),
		]),
	]);
	// What the source computed each of those with, as its pairing plan recorded it (Q149). It is
	// the reference the formulas are written against, not something this page edits.
	const reference = $derived(portalReference(members, parameters, namedCodes));

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
			const [script, rows, params, consts, steps, memberRows] = await Promise.all([
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
				listAll<ParameterGroupMember>(api.parameterGroupMembers, { perPage: 500 }),
			]);
			calculation = script;
			// The counts are what the save's arms are stated in. A page that cannot read them still
			// saves, and the arms say what they do without the numbers.
			listToolVersionUsage(calculationId)
				.then((rows) => (usage = rows))
				.catch(() => (usage = []));
			const declared = await declaredSteps(steps);
			stored = [...rows.data.map(editableFormula), ...declared];
			formulas = [...rows.data.map(editableFormula), ...declared];
			parameters = params;
			constants = consts;
			members = memberRows;
			// A step this calculation already reads, or already owns, is not one to bring in.
			const own = new Set(stored.map((f) => f.id));
			shareable = steps.filter((s) => !own.has(s.id));
		} catch (e) {
			error =
				e instanceof ApiError && (e.status === 401 || e.status === 403)
					? AUTHORING_REFUSED
					: e instanceof Error
						? e.message
						: 'Failed to load the calculation';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await load();
		if (siteId) await loadVisits(siteId, page.url.searchParams.get('visit') ?? '');
	});

	function add() {
		formulas = [...formulas, blankFormula(formulas)];
		editing = formulas.length - 1;
	}

	/** Close the editor on a formula the set will carry. Nothing is written until the set is saved;
	 *  the visit is read again, so the edit is seen moving through the steps to the outputs. */
	function done(f: EditableFormula) {
		if (!f.code.trim() || !f.formula.trim() || diagnostics.length > 0) return;
		editing = null;
		if (visit) void runAtVisit();
	}

	/**
	 * Write the whole formula set as one version. The arm says what happens to the values the
	 * version being replaced produced: left where they are, or recomputed under the new one.
	 */
	async function saveSet(migrate: boolean) {
		if (editing !== null || !unsaved) return;
		busy = true;
		try {
			const res = await saveFormulaSet(calculationId, formulaSetBody(formulas, migrate));
			await load();
			toastStore.success(
				res.version_no === null
					? 'Saved; the formulas read as they did, so no version was minted'
					: res.migrated
						? `Version ${res.version_no} saved; the values it replaces are being recomputed`
						: `Version ${res.version_no} saved`,
			);
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

	/** Drop a formula from the pending set. The save deletes it, by leaving it out. */
	function remove(f: EditableFormula) {
		formulas = formulas.filter((x) => x !== f);
		editing = null;
	}

	/** Keep the site and the visit in the URL, so a calculation read at a visit is a link. */
	function rememberVisit() {
		const url = new URL(page.url);
		for (const [key, value] of [
			['site', siteId],
			['visit', visitId],
		]) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	async function loadVisits(site: string, keep = '') {
		visits = [];
		visitId = '';
		run = null;
		if (!site) {
			rememberVisit();
			return;
		}
		visitsLoading = true;
		try {
			const res = await listSiteVisits(site, { page_size: 50 });
			visits = res.visits;
			// A visit named in the URL is the one to open, if the site still holds it.
			if (keep && visits.some((v) => v.id === keep)) {
				visitId = keep;
				await runAtVisit();
			}
		} catch (e) {
			runError = e instanceof Error ? e.message : 'Failed to load visits';
		} finally {
			visitsLoading = false;
			rememberVisit();
		}
	}

	/** Choosing a visit reads the calculation over it at once: the numbers are the page. */
	async function chooseVisit() {
		rememberVisit();
		run = null;
		if (visitId) await runAtVisit();
	}

	async function runAtVisit() {
		if (!visit) return;
		running = true;
		runError = '';
		try {
			run = await draftRunFormulas(
				calculationId,
				draftRunBody(
					formulas,
					{ siteId, collectedAt: visit.collected_at },
					replicateText,
					Object.fromEntries(slots.map((slot) => [slot, curveField(curveChoice[slot])])),
					scalarOverrides(inputs, scalarText),
				),
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
		</div>
	</div>

	{#if error}
		<ErrorNotice message={error} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		<!-- The visit the calculation is read at. Choosing one runs the set as it stands,
		     saved or not, against the visit's stored values. Nothing is written. -->
		<section class="rounded-md border border-brand-divider bg-brand-surface">
			<div class="px-3 py-3 space-y-3">
				<div class="flex flex-wrap items-end gap-2">
					<label class="text-xs text-brand-muted">Site
						<SiteSelect bind:value={siteId} class="block mt-0.5 {inputCls}" onchange={(s) => loadVisits(s)} />
					</label>
					<label class="text-xs text-brand-muted">Visit
						<select bind:value={visitId} onchange={chooseVisit} disabled={!siteId || visitsLoading} class="block mt-0.5 {inputCls} min-w-56">
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
					{#each scalars as scalar (scalar.name)}
						<label class="text-xs text-brand-muted">{scalar.name}
							<input bind:value={scalarText[scalar.name]} placeholder={resolved[scalar.name] ?? (scalar.kind === 'constant' ? 'catalog' : 'from the visit')} class="block mt-0.5 {inputCls} w-28" />
						</label>
					{/each}
					<Button size="sm" variant="primary" loading={running} disabled={!visit || ordered.length === 0} onclick={runAtVisit}>Run</Button>
				</div>
				{#if slots.length > 0}
					<div class="grid gap-3 sm:grid-cols-2">
						{#each slots as slot (slot)}
							<CurvePicker
								title="Curve slot {slot}"
								siteId={siteId || null}
								bind:value={
									() => curveChoice[slot] ?? emptyCurveSelection(),
									(v) => (curveChoice = { ...curveChoice, [slot]: v })
								}
							/>
						{/each}
					</div>
				{/if}
			</div>
		</section>

		<div class="grid grid-cols-1 xl:grid-cols-[minmax(420px,3fr)_minmax(320px,2fr)] gap-4 items-start">
			<!-- The visit's data, in the portal's order: what was read, what is fixed, the steps,
			     then what the calculation publishes. -->
			<section class="rounded-md border border-brand-divider bg-brand-surface">
				<div class="px-3 py-2 border-b border-brand-divider">
					<h3 class="text-sm font-semibold">At this visit</h3>
					<p class="text-xs text-brand-muted">The formulas as they stand{unsaved ? ', unsaved edits included' : ''}, over the visit's stored values. Nothing is written.</p>
				</div>
				<div class="px-3 py-3 space-y-3">
					{#if !visit}
						<p class="text-sm text-brand-muted">Choose a site and a visit to read the calculation over its values.</p>
					{/if}
					{#if runError}<ErrorNotice message={runError} />{/if}
					{#if run && !run.ran && run.failure}
						<ErrorNotice message={run.failure.message} />
					{/if}
					{#if run?.ran}
						{#if tables}<RunResultsTable {tables} inputs={given} trace={run?.trace ?? []} />{/if}
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
											<input bind:value={f.code} placeholder="CO2_HS_Um" class={inputCls} disabled={!!f.codeLocked} title={f.codeLocked ?? ''} />
											{#if f.codeLocked}
												<span class="mt-1 block text-[11px] text-brand-muted">Published: {f.codeLocked}. The code is the CSV column header and the public identifier.</span>
											{/if}
										</label>
										<label class="text-xs text-brand-muted">Name
											<input bind:value={f.name} placeholder="CO2 headspace" class={inputCls} />
										</label>
										<label class="text-xs text-brand-muted">Units
											<input bind:value={f.units} placeholder="uM" class={inputCls} />
										</label>
									</div>
									<label class="text-xs text-brand-muted block">Description
										<input bind:value={f.description} placeholder="The portal function this transcribes, and what it assumes" class={inputCls} />
									</label>
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
										<Button size="sm" variant="primary" disabled={!f.code.trim() || !f.formula.trim() || diagnostics.length > 0} onclick={() => done(f)}>Done</Button>
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
										{#if f.description}<p class="text-xs text-brand-muted">{f.description}</p>{/if}
										{#if f.declarationId && f.id && expanded === f.id}
											{@const feeds = dependents[f.id]}
											<div class="mt-1 rounded-md border border-brand-divider bg-brand-bg px-2 py-1">
												{#if feeds}
													<p class="text-xs text-brand-muted">Read by</p>
													<ul class="text-xs">
														{#each feeds.calculations as reader (reader.tool_script_id)}
															<li>
																<a href="{base}/toolbox/{reader.tool_script_id}" class="text-brand-primary no-underline hover:underline">{reader.label || reader.name}</a>
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
											<ConfirmPopover message="Drop {f.code || 'this formula'} from the calculation? The save deletes it." confirmLabel="Drop" onconfirm={() => remove(f)}>
												<Button size="sm" variant="ghost" disabled={busy}>Drop</Button>
											</ConfirmPopover>
										{/if}
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
				<!-- One save over the whole set, and what it does to the values already computed. -->
				<div class="border-t border-brand-divider px-3 py-2">
					{#if unsaved}
						<p class="text-sm">
							Unsaved: the set holds {formulas.filter((f) => !f.declarationId).length} formula{formulas.filter((f) => !f.declarationId).length === 1 ? '' : 's'}{dropped.length > 0 ? `, and drops ${dropped.map((f) => f.code).join(', ')}` : ''}.
						</p>
						<p class="text-xs text-brand-muted">Saving writes the whole set as one version, whatever it changed.{supersedes ? ' Choose what happens to the values the version it replaces produced.' : ''}</p>
						<div class="mt-2 flex flex-wrap gap-2">
							<Button size="sm" variant="primary" loading={busy} disabled={busy || editing !== null} onclick={() => saveSet(false)}>Save as a new version</Button>
							{#if supersedes}
								<Button size="sm" loading={busy} disabled={busy || editing !== null} onclick={() => saveSet(true)}>Save and recompute</Button>
							{/if}
						</div>
						{#if supersedes}
							<p class="mt-1 text-xs text-brand-muted">{armConsequence(activeUsage)}</p>
						{/if}
						{#if editing !== null}
							<p class="mt-1 text-xs text-brand-muted">Finish the formula you are editing first.</p>
						{/if}
					{:else}
						<p class="text-sm text-brand-muted">Saved. The calculation runs as its active version.</p>
					{/if}
				</div>
			</section>
		</div>

		<details class="rounded-md border border-brand-divider bg-brand-surface">
			<summary class="px-3 py-2 text-sm font-semibold cursor-pointer">Inputs<span class="ml-2 text-xs font-normal text-brand-muted">what the set reads, and how a run supplies it</span></summary>
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
		</details>

		<details class="rounded-md border border-brand-divider bg-brand-surface">
			<summary class="px-3 py-2 text-sm font-semibold cursor-pointer">Outputs<span class="ml-2 text-xs font-normal text-brand-muted">what a run publishes</span></summary>
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
		</details>

		{#if reference.length > 0}
			<!-- What the source computed these columns with, carried by the plan that paired them. -->
			<details class="rounded-md border border-brand-divider bg-brand-surface">
				<summary class="px-3 py-2 text-sm font-semibold cursor-pointer">Portal reference<span class="ml-2 text-xs font-normal text-brand-muted">what the source computed each column with, as its pairing plan recorded it</span></summary>
				<ul class="divide-y divide-brand-divider">
					{#each reference as recorded (recorded.code)}
						<li class="px-3 py-2 text-sm">
							<span class="font-mono">{recorded.code}</span>
							<span class="text-brand-muted"> = </span>
							<span class="font-mono">{recorded.function}({recorded.inputs.join(', ')})</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if calculation && calculation.versions.length > 0}
			<!-- Version history: which of them the record's values were computed under. -->
			<details class="rounded-md border border-brand-divider bg-brand-surface">
				<summary class="px-3 py-2 text-sm font-semibold cursor-pointer">Versions<span class="ml-2 text-xs font-normal text-brand-muted">every save mints one, and each holds the values computed while it was active</span></summary>
				<ul class="divide-y divide-brand-divider">
					{#each calculation.versions as version (version.id)}
						<li class="px-3 py-2 text-sm flex items-start justify-between gap-3 flex-wrap">
							<div>
								<span class="font-medium">Version {version.version_no}</span>
								{#if version.active}<Badge variant="ok">active</Badge>{/if}
								<span class="text-xs text-brand-muted"> · {formatDateTime(version.created_at)}{version.created_by ? ` · ${version.created_by}` : ''}</span>
								{#if version.note}<p class="text-xs text-brand-muted">{version.note}</p>{/if}
							</div>
							<span class="text-xs text-brand-muted">{storedLabel(usageByVersion.get(version.id)) || 'counting…'}</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</div>
