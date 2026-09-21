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
		type GivenUpOutput,
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
		scalarOverrides,
		type EditableFormula,
	} from '$lib/calculations/editor';
	import { armConsequence, storedLabel } from '$lib/calculations/consequence';
	import { portalReference, replicatedCodes } from '$lib/calculations/members';
	import { curveField } from '$lib/tools/form';
	import { runInputTables, runTables } from '$lib/tools/runTable';
	import {
		insertIdentifier,
		rowKey,
		sheetBlocks,
		withReplicate,
		type DeclaredInput,
		type SheetEdit,
		type SheetRow,
		type SheetSelection,
	} from '$lib/calculations/sheet';
	import type { DragPayload } from '$components/formula/ast';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import FormulaPalette from '$components/formula/FormulaPalette.svelte';
	import CalculationSheet from '$components/toolbox/CalculationSheet.svelte';
	import CellPanel from '$components/toolbox/CellPanel.svelte';
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
	/** What the last save stopped publishing, so the page says what it left behind. */
	let givenUp: GivenUpOutput[] = $state([]);

	let diagnostics = $state<Diagnostic[]>([]);
	// The cell the reader is on, and the formula the panel edits: the selected row's, or one just
	// added, which the tables cannot show until it has a code.
	let selected = $state<SheetSelection | null>(null);
	let picked = $state<EditableFormula | null>(null);
	// Inputs brought in from the palette before a formula names one. They are rows of the table and
	// nothing else: the save does not keep them.
	let declared = $state<DeclaredInput[]>([]);
	// Every input and formula change bumps the generation; a run remembers the one it read, so the
	// numbers on screen say whether they are still the ones being shown.
	let generation = $state(0);
	let ranAt = $state(0);
	let requests = 0;
	let rerunTimer: ReturnType<typeof setTimeout> | null = null;

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

	// The three tables the page is: the set's inputs, steps and outputs, filled by the run.
	const blocks = $derived(sheetBlocks(formulas, inputs, declared, given, tables ?? undefined));
	const stale = $derived(run !== null && ranAt < generation);

	const selectedRow = $derived(
		selected
			? ((blocks.find((b) => b.key === selected!.block)?.rows ?? []).find(
					(r) => r.key === selected!.key,
				) ?? null)
			: null,
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
		if (!f.id || dependents[f.id]) return;
		try {
			dependents = { ...dependents, [f.id]: await getStepDependents(f.id) };
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not read what the step feeds');
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

	/** Append a row to the steps or to the outputs, and open the panel on it. */
	function addRow(block: 'steps' | 'outputs') {
		const blank = blankFormula(formulas);
		blank.intermediate = block === 'steps';
		formulas = [...formulas, blank];
		const added = formulas[formulas.length - 1]!;
		picked = added;
		selected = { block, key: rowKey(added), column: 0 };
	}

	/** A cell was typed, pasted or filled into: a dummy value, or the code of a new row. */
	function applyEdit(edit: SheetEdit) {
		if (!edit) return;
		if (edit.kind === 'replicate') {
			const list = withReplicate(replicateText[edit.name] ?? '', edit.index, edit.text);
			replicateText = { ...replicateText, [edit.name]: list };
		} else if (edit.kind === 'scalar') {
			scalarText = { ...scalarText, [edit.name]: edit.text };
		} else {
			const target = formulas.find((f) => rowKey(f) === edit.key);
			if (target) target.code = edit.text.trim();
		}
	}

	/** What a palette entry writes when it is dropped: an identifier, or a name for the run to
	 *  supply a value for. */
	function payloadName(payload: DragPayload): string {
		if (payload.kind === 'operator') return payload.op;
		if (payload.kind === 'function') return `${payload.name}()`;
		return payload.name;
	}

	function dropPayload(
		block: 'inputs' | 'steps' | 'outputs',
		row: SheetRow | null,
		payload: DragPayload,
	) {
		if (block === 'inputs') {
			if (payload.kind === 'operator' || payload.kind === 'function') return;
			const name = payload.name;
			if (inputs.some((i) => i.name === name) || declared.some((d) => d.name === name)) return;
			const constant = constants.find((c) => c.name === name);
			const parameter = parameters.find((p) => p.code === name);
			declared = [
				...declared,
				constant
					? { name, kind: 'constant', detail: constant.units ? `${constant.value} ${constant.units}` : String(constant.value) }
					: parameter
						? { name, kind: 'parameter', detail: parameter.default_units ? `${parameter.name} (${parameter.default_units})` : parameter.name }
						: { name, kind: 'other', detail: 'resolved by the server as a site property' },
			];
			return;
		}
		const target = formulas.find((f) => rowKey(f) === row?.key);
		if (target) target.formula = insertIdentifier(target.formula, payloadName(payload)).formula;
	}

	/** Open a row in the panel, from a cell of the tables or from a link in the panel itself. */
	function choose(next: SheetSelection | string | null) {
		selected =
			typeof next === 'string'
				? { block: 'outputs', key: next, column: 0 }
				: next;
		picked = selected
			? (formulas.find((f) => f.code.trim() === selected!.key) ?? null)
			: null;
	}

	/** A palette pick is written into the formula the panel holds, at its end. */
	function insert(payload: DragPayload) {
		if (!picked) return;
		picked.formula = insertIdentifier(picked.formula, payloadName(payload)).formula;
	}

	/**
	 * Write the whole formula set as one version. The arm says what happens to the values the
	 * version being replaced produced: left where they are, or recomputed under the new one.
	 */
	async function saveSet(migrate: boolean) {
		if (diagnostics.length > 0 || !unsaved) return;
		busy = true;
		try {
			const res = await saveFormulaSet(calculationId, formulaSetBody(formulas, migrate));
			givenUp = res.given_up ?? [];
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

	/** Drop a formula from the pending set. The save deletes it, by leaving it out. */
	function remove(f: EditableFormula) {
		formulas = formulas.filter((x) => x !== f);
		if (picked === f) picked = null;
		selected = null;
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

	/** Choosing a visit reads the calculation over it: the numbers are the page. */
	function chooseVisit() {
		rememberVisit();
		run = null;
	}

	/**
	 * Read the set as it stands. Nothing is written: `draft_run` computes and returns, and a run
	 * with no visit is on the typed numbers alone.
	 *
	 * Responses are tagged, so one that was launched earlier never replaces a later one's numbers.
	 */
	async function runAtVisit() {
		const seq = ++requests;
		const at = generation;
		running = true;
		runError = '';
		try {
			const result = await draftRunFormulas(
				calculationId,
				draftRunBody(
					formulas,
					visit ? { siteId, collectedAt: visit.collected_at } : null,
					replicateText,
					Object.fromEntries(slots.map((slot) => [slot, curveField(curveChoice[slot])])),
					scalarOverrides(inputs, scalarText),
				),
			);
			if (seq !== requests) return;
			run = result;
			ranAt = at;
		} catch (e) {
			if (seq !== requests) return;
			run = null;
			runError = e instanceof Error ? e.message : 'The run was refused';
		} finally {
			if (seq === requests) running = false;
		}
	}

	/** What a run reads, so a change to any of it is a change to the numbers on screen. */
	const runSignature = $derived(
		JSON.stringify([
			formulas.map((f) => [f.code, f.formula, f.per_replicate, f.curve_slot, f.intermediate]),
			replicateText,
			scalarText,
			siteId,
			visitId,
			slots.map((slot) => curveField(curveChoice[slot])),
		]),
	);
	let lastSignature = '';
	// A change reruns the draft once it has settled, rather than on every keystroke.
	$effect(() => {
		const next = runSignature;
		if (loading || next === lastSignature) return;
		lastSignature = next;
		if (ordered.length === 0) return;
		generation += 1;
		if (rerunTimer) clearTimeout(rerunTimer);
		rerunTimer = setTimeout(() => {
			rerunTimer = null;
			void runAtVisit();
		}, 400);
	});

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
					<Button size="sm" variant="primary" disabled={ordered.length === 0} onclick={runAtVisit}>Run</Button>
					{#if running}<span class="text-xs text-brand-muted">Reading…</span>{/if}
					<p class="text-xs text-brand-muted">
						Type a value into an input cell to read the set over it. With no visit chosen the
						run is on the typed numbers alone.
					</p>
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

		<!-- The calculation as three tables of the visit's data, the palette beside them and the
		     selected cell under them. -->
		<div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_14rem] gap-4 items-start">
			<section class="min-w-0 rounded-md border border-brand-divider bg-brand-surface">
				<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-brand-divider">
					<div>
						<h3 class="text-sm font-semibold">At this visit</h3>
						<p class="text-xs text-brand-muted">The formulas as they stand{unsaved ? ', unsaved edits included' : ''}, over the visit's stored values. Nothing is written.</p>
					</div>
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
					</div>
				</div>
				<div class="px-3 py-3 space-y-3">
					{#if !visit}
						<p class="text-sm text-brand-muted">Choose a site and a visit to read the calculation over its values.</p>
					{/if}
					{#if runError}<ErrorNotice message={runError} />{/if}
					{#if run && !run.ran && run.failure}
						<ErrorNotice message={run.failure.message} />
					{/if}
					<CalculationSheet
						{blocks}
						{formulas}
						trace={run?.trace ?? []}
						{stale}
						bind:selected
						onselect={choose}
						onedit={applyEdit}
						ondrop={dropPayload}
						onadd={addRow}
					/>
					{#if (run?.skipped?.length ?? 0) > 0}
						<ul class="text-xs text-brand-muted">
							{#each run?.skipped ?? [] as s, i (i)}
								<li><span class="font-mono">{s.output}</span> not run: {s.reason}</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>
			<FormulaPalette
				variables={paramVars}
				{constants}
				onpick={insert}
				class="rounded-md border border-brand-divider bg-brand-surface p-2 max-h-[460px] overflow-y-auto"
			/>
		</div>

		<CellPanel
			row={selectedRow}
			selection={selected}
			formula={picked}
			{formulas}
			variables={paramVars}
			{constants}
			trace={run?.trace ?? []}
			bind:diagnostics
			consequence={supersedes ? armConsequence(activeUsage) : null}
			dependents={picked?.id ? (dependents[picked.id] ?? null) : null}
			{busy}
			onselect={choose}
			onedited={() => visit && runAtVisit()}
			ondrop={remove}
			onstopreading={stopReading}
			onshowdependents={showDependents}
		/>

		<!-- One save over the whole set, and what it does to the values already computed. -->
		<section class="rounded-md border border-brand-divider bg-brand-surface px-3 py-2">
			{#if unsaved}
				<p class="text-sm">
					Unsaved: the set holds {formulas.filter((f) => !f.declarationId).length} formula{formulas.filter((f) => !f.declarationId).length === 1 ? '' : 's'}{dropped.length > 0 ? `, and drops ${dropped.map((f) => f.code).join(', ')}` : ''}.
				</p>
				<p class="text-xs text-brand-muted">Saving writes the whole set as one version, whatever it changed.{supersedes ? ' Choose what happens to the values the version it replaces produced.' : ''}</p>
				<div class="mt-2 flex flex-wrap gap-2">
					<Button size="sm" variant="primary" loading={busy} disabled={busy || diagnostics.length > 0} onclick={() => saveSet(false)}>Save as a new version</Button>
					{#if supersedes}
						<Button size="sm" loading={busy} disabled={busy || diagnostics.length > 0} onclick={() => saveSet(true)}>Save and recompute</Button>
					{/if}
				</div>
				{#if supersedes}
					<p class="mt-1 text-xs text-brand-muted">{armConsequence(activeUsage)}</p>
				{/if}
				{#if diagnostics.length > 0}
					<p class="mt-1 text-xs text-brand-muted">Put right what the formula says wrong first.</p>
				{/if}
			{:else}
				<p class="text-sm text-brand-muted">Saved. The calculation runs as its active version.</p>
			{/if}
			{#each givenUp as gone (gone.parameter_id)}
				<!-- Ticking an output as a step stops publication and deletes nothing. -->
				<p class="mt-2 text-sm">
					<span class="font-mono">{gone.code}</span> is a step now, so the calculation no longer publishes it.
					{gone.readings_retained} reading{gone.readings_retained === 1 ? '' : 's'} stay under the parameter, and ticking it back as an output publishes them again.
				</p>
				{#if gone.read_by.length > 0 || gone.sites.length > 0}
					<p class="text-xs text-brand-muted">
						{#if gone.read_by.length > 0}Read by {gone.read_by.join(', ')}.{/if}
						{#if gone.sites.length > 0} Held at {gone.sites.join(', ')}.{/if}
					</p>
				{/if}
			{/each}
		</section>

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
