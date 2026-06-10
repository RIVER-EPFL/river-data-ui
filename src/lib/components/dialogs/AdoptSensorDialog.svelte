<script lang="ts">
	import { api, type Sensor, type Site, type SiteParameter, type SensorDeployment, type Parameter } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import { base } from '$app/paths';

	let {
		open = $bindable(false),
		sensor,
		sites,
		parameters,
		onsuccess,
	}: {
		open: boolean;
		sensor: Sensor;
		sites: Site[];
		parameters: Parameter[];
		onsuccess?: () => void;
	} = $props();

	let mode = $state<'choose' | 'adopt' | 'import'>('choose');
	let selectedSiteId = $state('');
	let selectedSiteParamId = $state('');
	let deployedFrom = $state(new Date().toISOString().slice(0, 16));
	let working = $state(false);

	let siteParams = $state<SiteParameter[]>([]);
	let openDeployments = $state<SensorDeployment[]>([]); // active deployments at chosen site

	$effect(() => {
		if (!selectedSiteId) { siteParams = []; openDeployments = []; return; }
		Promise.all([
			api.siteParameters.list({ perPage: 200, filter: { site_id: selectedSiteId } }),
			api.sensorDeployments.list({ perPage: 200, filter: { site_id: selectedSiteId, deployed_until: null } }),
		]).then(([sp, dep]) => { siteParams = sp.data; openDeployments = dep.data; });
	});

	// Swap suggestion: which sensor currently holds the slot this sensor's parameter would occupy.
	const incumbent = $derived.by(() => {
		const sp = siteParams.find((s) => s.id === selectedSiteParamId);
		if (!sp) return null;
		const dep = openDeployments.find((d) => d.parameter_id === sp.parameter_id && d.sensor_id !== sensor.id);
		return dep ?? null;
	});

	function paramName(id: string) { return parameters.find((p) => p.id === id)?.name ?? id; }

	// Only show site_parameters whose global parameter matches this sensor's parameter_id.
	const compatibleSiteParams = $derived(siteParams.filter((sp) => sp.parameter_id === sensor.parameter_id));

	async function adopt() {
		if (!selectedSiteId || !deployedFrom) return;
		working = true;
		try {
			await api.sensorDeployments.create({
				sensor_id: sensor.id,
				site_id: selectedSiteId,
				deployed_from: new Date(deployedFrom).toISOString(),
				deployment_type: 'permanent',
			});
			toastStore.success(incumbent
				? 'Slot adopted - incumbent deployment closed; readings re-coordinated in the background'
				: 'Sensor deployed - readings re-coordinated in the background');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Adopt failed');
		} finally { working = false; }
	}
</script>

<Dialog bind:open title="Add data for {sensor.name ?? sensor.serial_number ?? 'sensor'}" maxWidth="md">
	{#snippet children()}
		{#if mode === 'choose'}
			<div class="grid grid-cols-2 gap-3">
				<button onclick={() => mode = 'adopt'} class="text-left p-4 rounded-md border border-brand-divider hover:border-brand-primary bg-brand-surface cursor-pointer">
					<div class="font-semibold text-sm mb-1">Adopt a site slot</div>
					<p class="text-xs text-brand-muted">Deploy this sensor onto a site/parameter slot. If another sensor holds it, its deployment is closed at your chosen time (swap).</p>
				</button>
				<a href="{base}/sites" onclick={() => open = false} class="text-left p-4 rounded-md border border-brand-divider hover:border-brand-primary bg-brand-surface no-underline text-brand-text">
					<div class="font-semibold text-sm mb-1">Import a CSV</div>
					<p class="text-xs text-brand-muted">Upload historical readings to a site (Site → Import CSV). Use when the sensor wrote files, not a live stream.</p>
				</a>
			</div>
		{:else if mode === 'adopt'}
			<div class="space-y-3">
				<div class="flex flex-col gap-1">
					<label for="ad-site" class="text-sm font-medium">Site</label>
					<select id="ad-site" bind:value={selectedSiteId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value=""> - Select site - </option>
						{#each sites as s}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</div>
				{#if selectedSiteId}
					<div class="flex flex-col gap-1">
						<label for="ad-sp" class="text-sm font-medium">Parameter slot</label>
						<select id="ad-sp" bind:value={selectedSiteParamId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value=""> - Select slot - </option>
							{#each compatibleSiteParams as sp}<option value={sp.id}>{sp.name ?? paramName(sp.parameter_id)}</option>{/each}
						</select>
						{#if compatibleSiteParams.length === 0}
							<p class="text-xs text-severity-warning">No matching parameter at this site for {paramName(sensor.parameter_id)}.</p>
						{/if}
					</div>
					{#if incumbent}
						<div class="p-2 rounded border border-severity-warning-border bg-severity-warning-soft text-xs">
							<span class="font-semibold text-severity-warning">Swap:</span> this slot is held by another sensor (deployment {incumbent.id.slice(0, 8)}). Adopting closes it at your chosen time.
						</div>
					{/if}
					<div class="flex flex-col gap-1">
						<label for="ad-from" class="text-sm font-medium">Deployed from</label>
						<input id="ad-from" type="datetime-local" bind:value={deployedFrom} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if mode === 'adopt'}
			<Button onclick={() => mode = 'choose'}>Back</Button>
			<Button variant="primary" onclick={adopt} disabled={working || !selectedSiteId}>{working ? 'Adopting…' : incumbent ? 'Swap & adopt' : 'Adopt'}</Button>
		{:else}
			<Button onclick={() => open = false}>Close</Button>
		{/if}
	{/snippet}
</Dialog>
