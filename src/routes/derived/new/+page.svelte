<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { api, type Parameter, type Site } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import VisualFormulaBuilder from '$lib/components/formula/VisualFormulaBuilder.svelte';
	import DerivedPreview from '$lib/components/derived/DerivedPreview.svelte';

	let allParams = $state<Parameter[]>([]);
	let allSites = $state<Site[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	let name = $state('');
	let displayName = $state('');
	let units = $state('');
	let formula = $state('');
	let description = $state('');

	const paramVars = $derived(
		allParams
			.filter((p) => p.category !== 'device_health')
			.map((p) => ({ name: p.name, label: p.display_name || p.name }))
	);

	const previewSites = $derived(allSites.map((s) => ({ id: s.id, name: s.name })));

	onMount(async () => {
		try {
			const [p, s] = await Promise.all([
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
			]);
			allParams = p.data;
			allSites = s.data;
		} finally {
			loading = false;
		}
	});

	async function handleSubmit() {
		if (!name || !formula) return;
		saving = true;
		try {
			await api.derivedParameters.create({
				name,
				display_name: displayName || name,
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

<div class="space-y-6">
	<div>
		<a href="{base}/derived" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Derived Parameters</a>
		<h2 class="text-xl font-semibold mt-1">New Derived Parameter</h2>
	</div>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else}
		<div class="space-y-5">
			<div class="grid grid-cols-3 gap-4 max-w-2xl">
				<div>
					<label for="dp-name" class="text-sm text-brand-muted block mb-1">Name <span class="text-severity-alarm">*</span></label>
					<input id="dp-name" bind:value={name} placeholder="e.g. DOmgL" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
				</div>
				<div>
					<label for="dp-display" class="text-sm text-brand-muted block mb-1">Display Name</label>
					<input id="dp-display" bind:value={displayName} placeholder="e.g. Dissolved Oxygen (mg/L)" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
				</div>
				<div>
					<label for="dp-units" class="text-sm text-brand-muted block mb-1">Units</label>
					<input id="dp-units" bind:value={units} placeholder="e.g. mg/L" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface" />
				</div>
			</div>

			<VisualFormulaBuilder bind:value={formula} variables={paramVars} />

			<div class="max-w-2xl">
				<label for="dp-desc" class="text-sm text-brand-muted block mb-1">Description</label>
				<textarea id="dp-desc" bind:value={description} rows={3} placeholder="Optional description" class="w-full px-3 py-2 text-sm border border-brand-divider rounded bg-brand-surface"></textarea>
			</div>

			<button
				onclick={handleSubmit}
				disabled={saving || !name || !formula}
				class="px-4 py-2 text-sm bg-brand-primary text-white rounded cursor-pointer hover:bg-brand-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{saving ? 'Creating...' : 'Create'}
			</button>
		</div>

		{#if formula}
			<DerivedPreview {formula} sites={previewSites} />
		{/if}
	{/if}
</div>
