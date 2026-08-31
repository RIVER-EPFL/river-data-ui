<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Parameter, type Site, type Constant, type SiteParameter, type DerivedParameter } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import VisualFormulaBuilder from '$lib/components/formula/VisualFormulaBuilder.svelte';
	import LivePreview from '$lib/components/derived/LivePreview.svelte';

	const defId = page.params.id!;

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

	// Alarm thresholds live on the output parameter; computed readings are
	// evaluated against them like any other reading.
	let outputParameterId = $state<string | null>(null);
	let warningMin = $state('');
	let warningMax = $state('');
	let alarmMin = $state('');
	let alarmMax = $state('');

	// bind:value on type="number" inputs yields numbers, not strings
	const toNum = (v: string | number): number | null => {
		const s = String(v).trim();
		return s === '' ? null : Number(s);
	};
	const fromNum = (n: number | null): string => (n == null ? '' : String(n));

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
				api.derivedParameters.get(defId),
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.siteParameters.list({ perPage: 1000 }),
				api.constants.list({ perPage: 200, sort: ['name', 'ASC'] }),
			]);
			def = d;
			allParams = p.data;
			allSites = s.data;
			allSiteParams = sp.data;
			constants = c.data;
			code = d.code;
			name = d.name ?? '';
			units = d.units ?? '';
			formula = d.formula ?? '';
			description = d.description ?? '';
			outputParameterId = d.output_parameter_id;
			if (d.output_parameter_id) {
				const op = await api.parameters.get(d.output_parameter_id);
				warningMin = fromNum(op.default_warning_min);
				warningMax = fromNum(op.default_warning_max);
				alarmMin = fromNum(op.default_alarm_min);
				alarmMax = fromNum(op.default_alarm_max);
			}
		} finally {
			loading = false;
		}
	});

	async function handleSave() {
		if (!code || !formula) return;
		saving = true;
		try {
			await api.derivedParameters.update(defId, {
				code,
				name: name || code,
				units,
				formula,
				description: description || undefined,
			});
			if (outputParameterId) {
				await api.parameters.update(outputParameterId, {
					default_warning_min: toNum(warningMin),
					default_warning_max: toNum(warningMax),
					default_alarm_min: toNum(alarmMin),
					default_alarm_max: toNum(alarmMax),
				});
			}
			toastStore.success('Derived parameter updated');
			goto(`${base}/derived/${defId}`);
		} catch (e) {
			toastStore.error(`Failed to update: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Edit {def?.name ?? 'Derived Parameter'} | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div>
		<a href="{base}/derived/{defId}" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Back</a>
		<h2 class="text-xl font-semibold mt-1">Edit {def?.name || def?.code || ''}</h2>
	</div>

	{#if loading}
		<p class="text-brand-muted">Loading…</p>
	{:else}
		<div class="grid grid-cols-3 gap-3 max-w-2xl">
			<div>
				<label for="dp-code" class="text-sm text-brand-muted block mb-1">Code <span class="text-severity-alarm">*</span></label>
				<input id="dp-code" bind:value={code} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
			<div>
				<label for="dp-name" class="text-sm text-brand-muted block mb-1">Name</label>
				<input id="dp-name" bind:value={name} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
			<div>
				<label for="dp-units" class="text-sm text-brand-muted block mb-1">Units</label>
				<input id="dp-units" bind:value={units} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
		</div>

		<div class="grid grid-cols-1 xl:grid-cols-[1fr_minmax(420px,560px)] gap-3 items-start">
			<VisualFormulaBuilder bind:value={formula} variables={paramVars} {constants} />
			<LivePreview {formula} sites={sitesWithAvailability} variableNames={variableNamesInFormula} />
		</div>

		<div class="max-w-2xl">
			<label for="dp-desc" class="text-sm text-brand-muted block mb-1">Description</label>
			<textarea id="dp-desc" bind:value={description} rows={2} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface"></textarea>
		</div>

		{#if outputParameterId}
			<div class="max-w-2xl">
				<h3 class="text-sm font-semibold mb-1">Alarm Thresholds</h3>
				<p class="text-xs text-brand-muted mb-2">Computed readings are evaluated against these defaults unless a site-specific threshold overrides them.</p>
				<div class="grid grid-cols-4 gap-3">
					<div>
						<label for="dp-wmin" class="text-sm text-brand-muted block mb-1">Warning Min</label>
						<input id="dp-wmin" type="number" step="any" bind:value={warningMin} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
					<div>
						<label for="dp-wmax" class="text-sm text-brand-muted block mb-1">Warning Max</label>
						<input id="dp-wmax" type="number" step="any" bind:value={warningMax} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
					<div>
						<label for="dp-amin" class="text-sm text-brand-muted block mb-1">Alarm Min</label>
						<input id="dp-amin" type="number" step="any" bind:value={alarmMin} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
					<div>
						<label for="dp-amax" class="text-sm text-brand-muted block mb-1">Alarm Max</label>
						<input id="dp-amax" type="number" step="any" bind:value={alarmMax} class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
					</div>
				</div>
			</div>
		{/if}

		<div class="flex gap-2">
			<Button
				variant="primary"
				onclick={handleSave}
				disabled={saving || !code || !formula}
			>
				{saving ? 'Saving…' : 'Save'}
			</Button>
			<a href="{base}/derived/{defId}" class="px-4 py-2 text-sm border border-brand-divider bg-brand-surface text-brand-text rounded no-underline cursor-pointer hover:bg-brand-bg">Cancel</a>
		</div>
	{/if}
</div>
