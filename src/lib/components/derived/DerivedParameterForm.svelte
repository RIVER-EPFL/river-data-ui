<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import {
		api,
		type Constant,
		type DerivedParameter,
		type Parameter,
		type Site,
		type SiteParameter,
	} from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { fromNum, thresholdPatch } from '$lib/derivedParameters';
	import Button from '$components/ui/Button.svelte';
	import VisualFormulaBuilder from '$lib/components/formula/VisualFormulaBuilder.svelte';
	import LivePreview from '$lib/components/derived/LivePreview.svelte';

	// The derived-parameter form in both modes. Thresholds live on the definition's output
	// parameter, which a create only learns the id of after the after-create hook has made it.
	let { mode, defId = null }: { mode: 'create' | 'edit'; defId?: string | null } = $props();

	let def = $state<DerivedParameter | null>(null);
	let allParams = $state<Parameter[]>([]);
	let allSites = $state<Site[]>([]);
	let allSiteParams = $state<SiteParameter[]>([]);
	let constants = $state<Constant[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	let code = $state('');
	let name = $state('');
	let units = $state('');
	let formula = $state('');
	let description = $state('');

	let outputParameterId = $state<string | null>(null);
	let thresholds = $state({ warningMin: '', warningMax: '', alarmMin: '', alarmMax: '' });

	const editing = untrack(() => mode === 'edit');
	const backHref = $derived(editing ? `${base}/derived/${defId}` : `${base}/parameters?type=derived`);

	const paramVars = $derived(
		allParams
			.filter((p) => p.category !== 'device_health')
			.map((p) => ({ name: p.code, label: `${p.name}${p.default_units ? ' (' + p.default_units + ')' : ''}`, category: p.category }))
	);

	const variableNamesInFormula = $derived.by(() => {
		const constantNames = new Set(constants.map((c) => c.name));
		const fns = new Set(['sqrt', 'abs', 'ln', 'log', 'sin', 'cos', 'tan', 'exp', 'floor', 'ceil', 'round', 'min', 'max', 'pi', 'e']);
		const ids = new Set<string>();
		for (const m of formula.matchAll(/[a-zA-Z_]\w*/g)) {
			const n = m[0];
			if (!fns.has(n) && !constantNames.has(n)) ids.add(n);
		}
		return [...ids];
	});

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
			const [d, p, s, sp, c] = await Promise.all([
				editing && defId ? api.derivedParameters.get(defId) : Promise.resolve(null),
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.siteParameters.list({ perPage: 1000 }),
				api.constants.list({ perPage: 200, sort: ['name', 'ASC'] }),
			]);
			allParams = p.data;
			allSites = s.data;
			allSiteParams = sp.data;
			constants = c.data;
			if (!d) return;
			def = d;
			code = d.code;
			name = d.name ?? '';
			units = d.units ?? '';
			formula = d.formula ?? '';
			description = d.description ?? '';
			outputParameterId = d.output_parameter_id;
			if (d.output_parameter_id) {
				const op = await api.parameters.get(d.output_parameter_id);
				thresholds = {
					warningMin: fromNum(op.default_warning_min),
					warningMax: fromNum(op.default_warning_max),
					alarmMin: fromNum(op.default_alarm_min),
					alarmMax: fromNum(op.default_alarm_max),
				};
			}
		} finally {
			loading = false;
		}
	});

	async function handleSubmit() {
		if (!code || !formula) return;
		saving = true;
		try {
			const values = { code, name: name || code, units, formula, description: description || undefined };
			// The output parameter is created by an after-create hook, so a create re-fetches the
			// definition to learn its id before it can write thresholds.
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
			if (patch && outputId) await api.parameters.update(outputId, patch);

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
			<VisualFormulaBuilder bind:value={formula} variables={paramVars} {constants} />
			<LivePreview {formula} sites={sitesWithAvailability} variableNames={variableNamesInFormula} />
		</div>

		<div class="max-w-2xl">
			<label for="dp-desc" class="text-sm text-brand-muted block mb-1">Description</label>
			<textarea id="dp-desc" bind:value={description} rows={2} placeholder="Optional description" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface"></textarea>
		</div>

		{#if !editing || outputParameterId}
			<div class="max-w-2xl">
				<h3 class="text-sm font-semibold mb-1">Alarm Thresholds</h3>
				<p class="text-xs text-brand-muted mb-2">Computed readings are evaluated against these defaults unless a site-specific threshold overrides them. Optional.</p>
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
			<Button variant="primary" onclick={handleSubmit} disabled={saving || !code || !formula}>
				{saving ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save' : 'Create'}
			</Button>
			{#if editing}
				<a href={backHref} class="px-4 py-2 text-sm border border-brand-divider bg-brand-surface text-brand-text rounded no-underline cursor-pointer hover:bg-brand-bg">Cancel</a>
			{/if}
		</div>
	{/if}
</div>
