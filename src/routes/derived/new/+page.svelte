<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { api, type Parameter, type Site, type Constant, type SiteParameter } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import VisualFormulaBuilder from '$lib/components/formula/VisualFormulaBuilder.svelte';
	import LivePreview from '$lib/components/derived/LivePreview.svelte';

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
			const [p, s, sp, c] = await Promise.all([
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.siteParameters.list({ perPage: 1000 }),
				api.constants.list({ perPage: 200, sort: ['name', 'ASC'] }),
			]);
			allParams = p.data;
			allSites = s.data;
			allSiteParams = sp.data;
			constants = c.data;
		} finally {
			loading = false;
		}
	});

	async function handleSubmit() {
		if (!code || !formula) return;
		saving = true;
		try {
			await api.derivedParameters.create({
				code,
				name: name || code,
				units,
				formula,
				description: description || undefined,
			});
			toastStore.success('Derived parameter created');
			goto(`${base}/derived`);
		} catch (e) {
			toastStore.error(`Failed to create: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>New Derived Parameter | River Data</title></svelte:head>

<div class="space-y-4">
	<div>
		<a href="{base}/parameters?type=derived" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Parameters (derived)</a>
		<h2 class="text-xl font-semibold mt-1">New Derived Parameter</h2>
	</div>

	{#if loading}
		<p class="text-brand-muted">Loading…</p>
	{:else}
		<div class="grid grid-cols-3 gap-3 max-w-2xl">
			<div>
				<label for="dp-code" class="text-sm text-brand-muted block mb-1">Code <span class="text-severity-alarm">*</span></label>
				<input id="dp-code" bind:value={code} placeholder="e.g. DOmgL" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
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

		<Button
			variant="primary"
			onclick={handleSubmit}
			disabled={saving || !code || !formula}
		>
			{saving ? 'Creating…' : 'Create'}
		</Button>
	{/if}
</div>
