<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Sensor, type Site } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	// Two modes:
	//  - 'site':   the site is fixed; pick a sensor to deploy here.
	//  - 'sensor': the sensor is fixed; pick a destination site (deploy or move).
	// A move is a single deployment create — the API's before_create hook closes
	// the sensor's open deployment at the new deployed_from, and one reprocessing
	// pass re-coordinates the readings.
	let {
		open = $bindable(false),
		mode,
		siteId = '',
		siteName = '',
		sensorId = '',
		sensorName = '',
		sites: sitesProp,
		sensors: sensorsProp,
		currentSiteName = '',
		onsuccess,
	}: {
		open: boolean;
		mode: 'site' | 'sensor';
		siteId?: string;
		siteName?: string;
		sensorId?: string;
		sensorName?: string;
		sites?: Site[];
		sensors?: Sensor[];
		currentSiteName?: string;
		onsuccess?: () => void;
	} = $props();

	let sensors = $state<Sensor[]>([]);
	let sites = $state<Site[]>([]);
	let selectedSensorId = $state('');
	let selectedSiteId = $state('');
	let deploymentType = $state('permanent');
	let deployedFrom = $state(new Date().toISOString().slice(0, 16));
	let working = $state(false);

	onMount(async () => {
		if (mode === 'site') {
			sensors = sensorsProp ?? (await api.sensors.list({ perPage: 200, filter: { is_active: true } })).data;
		} else {
			sites = sitesProp ?? (await api.sites.list({ perPage: 200 })).data;
		}
	});

	const targetSiteName = $derived(
		mode === 'site' ? siteName : (sites.find((s) => s.id === selectedSiteId)?.name ?? '')
	);
	const sensorLabel = (s: Sensor) => s.serial_number ?? s.name ?? s.id;

	async function handleSubmit() {
		const sensor_id = mode === 'site' ? selectedSensorId : sensorId;
		const site_id = mode === 'site' ? siteId : selectedSiteId;
		if (!sensor_id || !site_id || !deployedFrom) return;
		working = true;
		try {
			await api.sensorDeployments.create({
				sensor_id,
				site_id,
				deployed_from: new Date(deployedFrom).toISOString(),
				deployment_type: deploymentType,
			});
			toastStore.success(currentSiteName ? 'Sensor moved — readings will be re-coordinated in the background' : 'Sensor deployed — readings will be re-coordinated in the background');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Deployment failed');
		} finally {
			working = false;
		}
	}
</script>

<Dialog bind:open title={mode === 'site' ? `Deploy a sensor to ${siteName}` : `Deploy / move ${sensorName}`} maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			{#if mode === 'site'}
				<div class="flex flex-col gap-1">
					<label for="dm-sensor" class="text-sm font-medium">Sensor</label>
					<select id="dm-sensor" bind:value={selectedSensorId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">— Select sensor —</option>
						{#each sensors as s}
							<option value={s.id}>{sensorLabel(s)}</option>
						{/each}
					</select>
				</div>
			{:else}
				<div class="flex flex-col gap-1">
					<label for="dm-site" class="text-sm font-medium">Destination site</label>
					<select id="dm-site" bind:value={selectedSiteId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">— Select site —</option>
						{#each sites as s}
							<option value={s.id}>{s.name}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="dm-from" class="text-sm font-medium">Deployed from</label>
					<input id="dm-from" type="datetime-local" bind:value={deployedFrom} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
				<div class="flex flex-col gap-1">
					<label for="dm-type" class="text-sm font-medium">Type</label>
					<select id="dm-type" bind:value={deploymentType} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="permanent">Permanent</option>
						<option value="field_campaign">Field campaign</option>
					</select>
				</div>
			</div>

			<p class="text-xs text-brand-muted">
				{#if currentSiteName}
					Closes the current deployment at {currentSiteName} at the chosen time and re-coordinates readings after the move to {targetSiteName || 'the selected site'} using this sensor's existing calibration windows. One reprocessing pass runs in the background.
				{:else}
					Readings will be coordinated to {targetSiteName || siteName || 'the site'} using this sensor's calibration windows; a reprocessing pass runs in the background.
				{/if}
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={() => (open = false)} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button
			onclick={handleSubmit}
			disabled={working || (mode === 'site' ? !selectedSensorId : !selectedSiteId)}
			class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50"
		>{working ? 'Saving…' : currentSiteName ? 'Move' : 'Deploy'}</button>
	{/snippet}
</Dialog>
