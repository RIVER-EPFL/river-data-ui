<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Project, type Site, type SiteParameter, type Parameter, type StandardCurve } from '$api/crud';
	import { POST } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';

	let projects = $state<Project[]>([]);
	let sites = $state<Site[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let params = $state<Parameter[]>([]);
	let standardCurves = $state<StandardCurve[]>([]);
	let loading = $state(true);

	// Form state
	let selectedProjectId = $state('');
	let selectedSiteId = $state('');
	let sampleDate = $state(new Date().toISOString().slice(0, 16));
	let rows = $state<Array<{
		paramId: string;
		replicates: string[];
		useStandardCurve: boolean;
		curveId: string;
	}>>([]);
	let submitting = $state(false);

	const filteredSites = $derived(selectedProjectId ? sites.filter((s) => s.project_id === selectedProjectId) : sites);
	const filteredParams = $derived(selectedSiteId ? siteParams.filter((sp) => sp.site_id === selectedSiteId) : []);

	onMount(async () => {
		try {
			const [p, s, sp, par, sc] = await Promise.all([
				api.projects.list({ perPage: 100 }),
				api.sites.list({ perPage: 200 }),
				api.siteParameters.list({ perPage: 1000 }),
				api.parameters.list({ perPage: 500 }),
				api.standardCurves.list({ perPage: 200 }),
			]);
			projects = p.data;
			sites = s.data;
			siteParams = sp.data;
			params = par.data;
			standardCurves = sc.data;
		} finally { loading = false; }
	});

	function paramName(paramId: string): string {
		return params.find((p) => p.id === paramId)?.display_name ?? paramId;
	}

	function paramUnits(sp: SiteParameter): string {
		const param = params.find((p) => p.id === sp.parameter_id);
		return sp.display_units ?? param?.default_units ?? '';
	}

	function addRow() {
		rows = [...rows, { paramId: '', replicates: [''], useStandardCurve: false, curveId: '' }];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	function addReplicate(rowIndex: number) {
		if (rows[rowIndex].replicates.length < 10) {
			rows[rowIndex].replicates = [...rows[rowIndex].replicates, ''];
		}
	}

	async function handleSubmit() {
		if (!selectedSiteId || rows.length === 0) return;
		submitting = true;
		try {
			const readings = rows.flatMap((row) => {
				const sp = filteredParams.find((fp) => fp.parameter_id === row.paramId);
				if (!sp) return [];
				return row.replicates
					.filter((v) => v !== '')
					.map((value, idx) => ({
						site_id: selectedSiteId,
						parameter_id: row.paramId,
						time: new Date(sampleDate).toISOString(),
						raw_value: Number(value),
						replicate_index: idx,
						sample_id: crypto.randomUUID(),
					}));
			});

			if (readings.length === 0) {
				toastStore.error('No readings to submit');
				return;
			}

			await POST('/api/service/grab_samples', { readings });
			toastStore.success(`Submitted ${readings.length} readings`);
			rows = [];
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Submit failed');
		} finally { submitting = false; }
	}
</script>

<svelte:head><title>Grab Samples | River Data</title></svelte:head>

<div class="space-y-6 max-w-3xl">
	<h2 class="text-xl font-semibold">Grab Sample Entry</h2>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else}
		<!-- Header fields -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<div>
				<label for="project" class="text-sm font-medium block mb-1">Project</label>
				<select id="project" bind:value={selectedProjectId} onchange={() => selectedSiteId = ''} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="">All projects</option>
					{#each projects as p}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</div>
			<div>
				<label for="site" class="text-sm font-medium block mb-1">Site <span class="text-severity-alarm">*</span></label>
				<select id="site" bind:value={selectedSiteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="">— Select site —</option>
					{#each filteredSites as s}<option value={s.id}>{s.name}</option>{/each}
				</select>
			</div>
			<div>
				<label for="date" class="text-sm font-medium block mb-1">Date/Time <span class="text-severity-alarm">*</span></label>
				<input id="date" type="datetime-local" bind:value={sampleDate} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>
		</div>

		<!-- Parameter rows -->
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold">Readings</h3>
				<button onclick={addRow} disabled={!selectedSiteId} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none disabled:opacity-50">+ Add Parameter</button>
			</div>

			{#each rows as row, i}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-3 space-y-2">
					<div class="flex items-center gap-3">
						<select bind:value={row.paramId} class="flex-1 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="">— Parameter —</option>
							{#each filteredParams as sp}
								<option value={sp.parameter_id}>{paramName(sp.parameter_id)} ({paramUnits(sp)})</option>
							{/each}
						</select>
						<button onclick={() => removeRow(i)} class="text-severity-alarm bg-transparent border-none cursor-pointer text-sm hover:underline">Remove</button>
					</div>

					<!-- Replicates -->
					<div class="flex items-center gap-2 flex-wrap">
						<span class="text-xs text-brand-muted w-16">Replicates:</span>
						{#each row.replicates as _, j}
							<input
								type="number"
								step="any"
								bind:value={row.replicates[j]}
								placeholder="Value"
								class="w-24 px-2 py-1 border border-brand-divider rounded text-sm bg-brand-surface"
							/>
						{/each}
						{#if row.replicates.length < 10}
							<button onclick={() => addReplicate(i)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">+ Rep</button>
						{/if}
					</div>
				</div>
			{/each}

			{#if rows.length === 0}
				<p class="text-sm text-brand-muted text-center py-6">Click "Add Parameter" to start entering grab sample readings</p>
			{/if}
		</div>

		{#if rows.length > 0}
			<button
				onclick={handleSubmit}
				disabled={submitting || !selectedSiteId}
				class="px-4 py-2 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50"
			>
				{submitting ? 'Submitting...' : 'Submit Grab Samples'}
			</button>
		{/if}
	{/if}
</div>
