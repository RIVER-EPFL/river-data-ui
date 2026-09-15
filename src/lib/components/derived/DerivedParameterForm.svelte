<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import {
		api,
		type AlarmThreshold,
		type Constant,
		type DerivedParameter,
		type Parameter,
		type Site,
		type SiteParameter,
	} from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { listToolScripts, type ToolScriptSummary } from '$api/service';
	import {
		formulaOwnership,
		formulaReads,
		formulaShape,
		fromNum,
		perReplicateChoices,
		thresholdPatch,
	} from '$lib/derivedParameters';
	import Button from '$components/ui/Button.svelte';
	import VisualFormulaBuilder from '$lib/components/formula/VisualFormulaBuilder.svelte';
	import type { Diagnostic } from '$lib/formula/lint';
	import LivePreview from '$lib/components/derived/LivePreview.svelte';

	// The derived-parameter form in both modes. The bounds live on the output parameter's global
	// threshold row, and a create only learns that parameter's id after the after-create hook.
	// A create authors a standalone definition or a shared step; a calculation's own formulas are
	// authored on its page.
	let { mode, defId = null }: { mode: 'create' | 'edit'; defId?: string | null } = $props();

	let def = $state<DerivedParameter | null>(null);
	let allParams = $state<Parameter[]>([]);
	let allSites = $state<Site[]>([]);
	let allSiteParams = $state<SiteParameter[]>([]);
	let constants = $state<Constant[]>([]);
	let calculations = $state<ToolScriptSummary[]>([]);
	/** The codes the owning calculation's other formulas publish, readable by this one. */
	let steps = $state<string[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	let code = $state('');
	let name = $state('');
	let units = $state('');
	let formula = $state('');
	let description = $state('');
	// What shape the formula runs in: over one input's replicates, and against a curve slot.
	let perReplicate = $state('');
	let curveSlot = $state('');
	let intermediate = $state(false);
	// What the builder says is wrong with the text. A formula that names something unknown is not
	// saved: the server would refuse it anyway, and here it is said before the work is done.
	let formulaDiagnostics = $state<Diagnostic[]>([]);

	let outputParameterId = $state<string | null>(null);
	let thresholds = $state({ warningMin: '', warningMax: '', alarmMin: '', alarmMax: '' });
	/** The output parameter's own bounds: its `alarm_thresholds` row with no site. */
	let globalThreshold = $state<AlarmThreshold | null>(null);

	/// The codes a formula of `calculationId` may read: every other formula of that calculation,
	/// its own and the steps it declares from elsewhere.
	async function loadSteps(calculationId: string, selfId: string): Promise<string[]> {
		const [own, declarations] = await Promise.all([
			api.derivedParameters.list({ perPage: 500, filter: { tool_script_id: calculationId } }),
			api.calculationSharedSteps.list({ perPage: 200, filter: { tool_script_id: calculationId } }),
		]);
		const declared = declarations.data.map((d) => d.formula_id);
		const shared = declared.length
			? (await api.derivedParameters.list({ perPage: 500, filter: { intermediate: true } })).data
			: [];
		return [
			...own.data.filter((f) => f.id !== selfId),
			...shared.filter((f) => declared.includes(f.id)),
		].map((f) => f.code);
	}

	async function loadGlobalThreshold(parameterId: string): Promise<AlarmThreshold | null> {
		const res = await api.alarmThresholds.list({ perPage: 200, filter: { parameter_id: parameterId } });
		return res.data.find((t) => t.site_id === null) ?? null;
	}

	const editing = untrack(() => mode === 'edit');
	const backHref = $derived(editing ? `${base}/derived/${defId}` : `${base}/parameters?type=derived`);
	/** The calculation an edited formula belongs to, where the definition names one. */
	const ownedBy = $derived.by(() => {
		const id = def?.tool_script_id;
		return id ? (calculations.find((c) => c.id === id) ?? null) : null;
	});

	const paramVars = $derived(
		allParams
			.filter((p) => p.category !== 'device_health')
			.map((p) => ({ name: p.code, label: `${p.name}${p.default_units ? ' (' + p.default_units + ')' : ''}`, category: p.category }))
	);

	const variableNamesInFormula = $derived(
		formulaReads(
			formula,
			constants.map((c) => c.name)
		)
	);
	/** What the preview asks a site for: a step is computed by the run, not measured there. */
	const previewVariableNames = $derived(variableNamesInFormula.filter((n) => !steps.includes(n)));

	const sitesWithAvailability = $derived(
		allSites.map((s) => {
			const paramIds = allSiteParams
				.filter((sp) => sp.site_id === s.id && sp.is_active)
				.map((sp) => sp.parameter_id);
			const paramNames = paramIds
				.map((pid) => allParams.find((p) => p.id === pid)?.code)
				.filter((n): n is string => !!n);
			return { id: s.id, name: s.name, availableParamNames: paramNames };
		})
	);

	onMount(async () => {
		try {
			const [d, p, s, sp, c, ts] = await Promise.all([
				editing && defId ? api.derivedParameters.get(defId) : Promise.resolve(null),
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.siteParameters.list({ perPage: 1000 }),
				api.constants.list({ perPage: 200, sort: ['name', 'ASC'] }),
				listToolScripts().catch(() => [] as ToolScriptSummary[]),
			]);
			allParams = p.data;
			allSites = s.data;
			allSiteParams = sp.data;
			constants = c.data;
			calculations = ts;
			if (!d) return;
			def = d;
			code = d.code;
			name = d.name ?? '';
			units = d.units ?? '';
			formula = d.formula ?? '';
			description = d.description ?? '';
			perReplicate = d.per_replicate ?? '';
			curveSlot = d.curve_slot ?? '';
			intermediate = d.intermediate ?? false;
			outputParameterId = d.output_parameter_id;
			if (d.tool_script_id) steps = await loadSteps(d.tool_script_id, d.id);
			if (d.output_parameter_id) {
				globalThreshold = await loadGlobalThreshold(d.output_parameter_id);
				thresholds = {
					warningMin: fromNum(globalThreshold?.warning_min),
					warningMax: fromNum(globalThreshold?.warning_max),
					alarmMin: fromNum(globalThreshold?.alarm_min),
					alarmMax: fromNum(globalThreshold?.alarm_max),
				};
			}
		} finally {
			loading = false;
		}
	});

	async function handleSubmit() {
		if (!code || !formula || formulaDiagnostics.length > 0) return;
		saving = true;
		try {
			const values = {
				code,
				name: name || code,
				units,
				formula,
				description: description || undefined,
				...formulaShape(perReplicate, curveSlot, intermediate),
				...formulaOwnership(def),
			};
			// The output parameter is created by an after-create hook, so a create re-fetches the
			// definition to learn its id before it can write its bounds.
			let outputId = outputParameterId;
			if (editing && defId) {
				await api.derivedParameters.update(defId, values);
			} else {
				const created = await api.derivedParameters.create(values);
				outputId =
					created.output_parameter_id ??
					(await api.derivedParameters.get(created.id)).output_parameter_id;
			}
			const patch = thresholdPatch(mode, thresholds);
			if (patch && outputId) {
				const existing = globalThreshold ?? (await loadGlobalThreshold(outputId));
				if (existing) await api.alarmThresholds.update(existing.id, patch);
				else await api.alarmThresholds.create({ parameter_id: outputId, ...patch });
			}

			toastStore.success(`Derived parameter ${editing ? 'updated' : 'created'}`);
			goto(editing ? `${base}/derived/${defId}` : `${base}/derived`);
		} catch (e) {
			const what = editing ? 'update' : 'create';
			toastStore.error(`Failed to ${what}: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{editing ? `Edit ${def?.name ?? 'Derived Parameter'}` : 'New Derived Parameter'} | RIVER Data</title>
</svelte:head>

<div class="space-y-4">
	<div>
		<a href={backHref} class="text-sm text-brand-muted hover:text-brand-primary no-underline">
			&larr; {editing ? 'Back' : 'Parameters (derived)'}
		</a>
		<h2 class="text-xl font-semibold mt-1">
			{editing ? `Edit ${def?.name || def?.code || ''}` : 'New Derived Parameter'}
		</h2>
		{#if ownedBy}
			<p class="text-sm text-brand-muted mt-1">
				A formula of <a href="{base}/calculations/{ownedBy.id}" class="text-brand-primary no-underline hover:underline">{ownedBy.label || ownedBy.name}</a>,
				which runs its formulas together and records one run.
			</p>
		{:else if !editing}
			<p class="text-sm text-brand-muted mt-1">
				Standalone: computed per source reading, belonging to no calculation.
			</p>
		{/if}
	</div>

	{#if loading}
		<p class="text-brand-muted">Loading…</p>
	{:else}
		<div class="grid grid-cols-3 gap-3 max-w-2xl">
			<div>
				<label for="dp-code" class="text-sm text-brand-muted block mb-1">Code <span class="text-severity-alarm">*</span></label>
				<input id="dp-code" bind:value={code} placeholder="e.g. DOmgL" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
				<p class="text-xs text-brand-muted mt-1">Every CSV and NDJSON export writes this as the column name, so carry the units in it the way the portal columns did (DOC_avg_ppb, WTW_Temp_degC_1).</p>
			</div>
			<div>
				<label for="dp-name" class="text-sm text-brand-muted block mb-1">Name</label>
				<input id="dp-name" bind:value={name} placeholder="e.g. Dissolved Oxygen (mg/L)" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
			<div>
				<label for="dp-units" class="text-sm text-brand-muted block mb-1">Units</label>
				<input id="dp-units" bind:value={units} placeholder="e.g. mg/L" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
		</div>

		<div class="grid grid-cols-1 xl:grid-cols-[1fr_minmax(420px,560px)] gap-3 items-start">
			<VisualFormulaBuilder
				bind:value={formula}
				bind:diagnostics={formulaDiagnostics}
				variables={paramVars}
				{constants}
				{steps}
				hasCurve={curveSlot.trim().length > 0}
				ownCode={code || undefined}
			/>
			<LivePreview {formula} sites={sitesWithAvailability} variableNames={previewVariableNames} />
		</div>

		<!-- What shape the formula runs in. A formula over a replicate vector writes one reading per
		     index under its output; a curve slot supplies `curve_slope` and `curve_intercept`. -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
			<div>
				<label for="dp-per-replicate" class="text-sm text-brand-muted block mb-1"
					>Per replicate over</label
				>
				<select
					id="dp-per-replicate"
					bind:value={perReplicate}
					class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface"
				>
					<option value="">Not per replicate, one value per visit</option>
					{#each perReplicateChoices(variableNamesInFormula) as variable (variable)}
						<option value={variable}>{variable}</option>
					{/each}
					{#if perReplicate && !variableNamesInFormula.includes(perReplicate)}
						<option value={perReplicate}>{perReplicate} (not in the formula)</option>
					{/if}
				</select>
				<p class="text-xs text-brand-muted mt-1">
					The input whose replicates this runs over, one reading per index under the output.
				</p>
			</div>
			<div class="md:col-span-2">
				<label class="flex items-start gap-2 text-sm">
					<input type="checkbox" bind:checked={intermediate} class="mt-1" />
					<span>
						{ownedBy ? 'A step of the calculation' : 'A step any calculation may read'}
						<span class="block text-xs text-brand-muted">
							{ownedBy
								? 'Its value reaches the formulas after it under this code, and is stored nowhere: no catalog parameter is created for it and nothing offers to save it.'
								: 'Its value reaches the formulas of every calculation that declares it, under this code, and is stored nowhere: no catalog parameter is created for it and nothing offers to save it.'}
						</span>
					</span>
				</label>
			</div>
			<div>
				<label for="dp-curve-slot" class="text-sm text-brand-muted block mb-1">Curve slot</label>
				<input
					id="dp-curve-slot"
					bind:value={curveSlot}
					placeholder="e.g. doc"
					class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface"
				/>
				<p class="text-xs text-brand-muted mt-1">
					The standard curve this formula corrects with. Its coefficients reach the formula as
					<span class="font-mono">curve_slope</span> and
					<span class="font-mono">curve_intercept</span>.
				</p>
			</div>
		</div>

		<div class="max-w-2xl">
			<label for="dp-desc" class="text-sm text-brand-muted block mb-1">Description</label>
			<textarea id="dp-desc" bind:value={description} rows={2} placeholder="Optional description" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface"></textarea>
		</div>

		{#if !editing || outputParameterId}
			<div class="max-w-2xl">
				<h3 class="text-sm font-semibold mb-1">Alarm Thresholds</h3>
				<p class="text-xs text-brand-muted mb-2">Computed readings are evaluated against these bounds unless a site-specific threshold overrides them. Optional.</p>
				<div class="grid grid-cols-4 gap-3">
					<div>
						<label for="dp-wmin" class="text-sm text-brand-muted block mb-1">Warning Min</label>
						<input id="dp-wmin" type="number" step="any" bind:value={thresholds.warningMin} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
					<div>
						<label for="dp-wmax" class="text-sm text-brand-muted block mb-1">Warning Max</label>
						<input id="dp-wmax" type="number" step="any" bind:value={thresholds.warningMax} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
					<div>
						<label for="dp-amin" class="text-sm text-brand-muted block mb-1">Alarm Min</label>
						<input id="dp-amin" type="number" step="any" bind:value={thresholds.alarmMin} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
					<div>
						<label for="dp-amax" class="text-sm text-brand-muted block mb-1">Alarm Max</label>
						<input id="dp-amax" type="number" step="any" bind:value={thresholds.alarmMax} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
				</div>
			</div>
		{/if}

		<div class="flex gap-2">
			<Button
				variant="primary"
				onclick={handleSubmit}
				disabled={saving || !code || !formula || formulaDiagnostics.length > 0}
			>
				{saving ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save' : 'Create'}
			</Button>
			{#if editing}
				<a href={backHref} class="px-4 py-2 text-sm border border-brand-divider bg-brand-surface text-brand-text rounded no-underline cursor-pointer hover:bg-brand-bg">Cancel</a>
			{/if}
		</div>
	{/if}
</div>
