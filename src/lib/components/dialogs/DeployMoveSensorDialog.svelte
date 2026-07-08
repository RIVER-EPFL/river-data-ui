<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Sensor, type Site, type SensorDeployment } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	// Two modes:
	//  - 'site':   the site is fixed; pick a sensor to deploy here.
	//  - 'sensor': the sensor is fixed; pick a destination site (deploy or move).
	// A move is a single deployment create - the API's before_create hook closes
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
		currentSiteName?: string;
		onsuccess?: () => void;
	} = $props();

	let sites = $state<Site[]>([]);
	let selectedSensorId = $state('');
	let selectedSiteId = $state('');
	let deploymentType = $state('permanent');
	let deployedFrom = $state(toDatetimeLocal(Date.now(), timezoneStore.zone));
	let working = $state(false);

	// ── Site-mode sensor picker (server-backed search + deployment awareness) ──
	let query = $state('');
	let searchResults = $state<Sensor[]>([]);
	let searching = $state(false);
	let showDeployed = $state(false);
	let selectedSensor = $state<Sensor | null>(null);
	let activeDepBySensor = $state<Map<string, SensorDeployment>>(new Map());
	let siteNameMap = $state<Map<string, string>>(new Map());
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	async function runSearch() {
		searching = true;
		try {
			const filter: Record<string, unknown> = { is_active: true };
			if (query.trim()) filter.q = query.trim();
			const res = await api.sensors.list({ page: 1, perPage: 20, sort: ['name', 'ASC'], filter });
			searchResults = res.data;
		} finally {
			searching = false;
		}
	}

	function onQueryInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(runSearch, 250);
	}

	onMount(async () => {
		if (mode === 'site') {
			const [depRes, siteRes] = await Promise.all([
				api.sensorDeployments.list({ perPage: 500, filter: { deployed_until: null } }),
				api.sites.list({ perPage: 200 }),
			]);
			activeDepBySensor = new Map(depRes.data.map((d) => [d.sensor_id, d]));
			siteNameMap = new Map(siteRes.data.map((s) => [s.id, s.name]));
			await runSearch();
		} else {
			sites = sitesProp ?? (await api.sites.list({ perPage: 200 })).data;
		}
	});

	// Hide sensors already deployed at THIS site; hide deployed-elsewhere ones unless toggled.
	const availableSensors = $derived(
		searchResults.filter((s) => {
			const dep = activeDepBySensor.get(s.id);
			if (dep && dep.site_id === siteId) return false;
			if (dep && !showDeployed) return false;
			return true;
		}),
	);

	function deployedSiteName(sensorId: string): string | null {
		const dep = activeDepBySensor.get(sensorId);
		if (!dep) return null;
		return siteNameMap.get(dep.site_id) ?? 'another site';
	}

	const selectedDep = $derived(selectedSensorId ? activeDepBySensor.get(selectedSensorId) ?? null : null);
	const isMove = $derived(!!selectedDep && selectedDep.site_id !== siteId);
	const sourceSiteName = $derived(selectedDep ? (siteNameMap.get(selectedDep.site_id) ?? 'another site') : '');

	function pickSensor(s: Sensor) {
		selectedSensor = s;
		selectedSensorId = s.id;
	}
	function clearSelection() {
		selectedSensor = null;
		selectedSensorId = '';
	}

	const sensorDisplay = (s: Sensor) => s.name ?? s.serial_number ?? s.id;

	const targetSiteName = $derived(
		mode === 'site' ? siteName : (sites.find((s) => s.id === selectedSiteId)?.name ?? ''),
	);
	const movingFrom = $derived(currentSiteName || (isMove ? sourceSiteName : ''));

	async function handleSubmit() {
		const sensor_id = mode === 'site' ? selectedSensorId : sensorId;
		const site_id = mode === 'site' ? siteId : selectedSiteId;
		if (!sensor_id || !site_id || !deployedFrom) return;
		working = true;
		try {
			await api.sensorDeployments.create({
				sensor_id,
				site_id,
				deployed_from: fromDatetimeLocal(deployedFrom, timezoneStore.zone),
				deployment_type: deploymentType,
			});
			toastStore.success(movingFrom ? 'Sensor moved - readings will be re-coordinated in the background' : 'Sensor deployed - readings will be re-coordinated in the background');
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
				<div class="flex flex-col gap-2">
					<span class="text-sm font-medium">Sensor</span>
					{#if selectedSensor}
						<div class="flex items-center gap-2 px-3 py-2 border border-brand-divider rounded-md bg-brand-bg">
							<div class="flex flex-col min-w-0">
								<span class="text-sm font-semibold truncate">{sensorDisplay(selectedSensor)}</span>
								<span class="text-xs text-brand-muted font-mono truncate">{selectedSensor.serial_number ?? 'None'}{selectedSensor.model ? ` · ${selectedSensor.model}` : ''}</span>
								{#if isMove}
									<span class="text-xs text-severity-warning">currently deployed at {sourceSiteName} - will be moved</span>
								{/if}
							</div>
							<Button variant="ghost" size="sm" class="ml-auto text-brand-primary" onclick={clearSelection}>Change</Button>
						</div>
					{:else}
						<input
							type="text"
							bind:value={query}
							oninput={onQueryInput}
							placeholder="Search by name or serial…"
							class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
						/>
						<label class="flex items-center gap-1.5 text-xs text-brand-muted cursor-pointer">
							<input type="checkbox" bind:checked={showDeployed} />
							Show deployed sensors
						</label>
						<div class="max-h-56 overflow-y-auto rounded-md border border-brand-divider divide-y divide-brand-divider">
							{#if searching}
								<div class="px-3 py-3 text-sm text-brand-muted text-center">Searching…</div>
							{:else if availableSensors.length === 0}
								<div class="px-3 py-3 text-sm text-brand-muted text-center">No matching sensors</div>
							{:else}
								{#each availableSensors as s (s.id)}
									{@const depSite = deployedSiteName(s.id)}
									<button
										type="button"
										onclick={() => pickSensor(s)}
										class="w-full text-left px-3 py-2 cursor-pointer bg-transparent border-none hover:bg-brand-bg flex flex-col gap-0.5"
									>
										<span class="text-sm font-semibold">{sensorDisplay(s)}</span>
										<span class="text-xs text-brand-muted font-mono">{s.serial_number ?? 'None'}{s.manufacturer ? ` · ${s.manufacturer}` : ''}{s.model ? ` ${s.model}` : ''}</span>
										{#if depSite}
											<span class="text-xs text-severity-warning">currently deployed at {depSite}</span>
										{/if}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-1">
					<label for="dm-site" class="text-sm font-medium">Destination site</label>
					<select id="dm-site" bind:value={selectedSiteId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value=""> - Select site - </option>
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
				{#if movingFrom}
					Closes the current deployment at {movingFrom} at the chosen time and re-coordinates readings after the move to {targetSiteName || siteName || 'the selected site'} using this sensor's existing calibration windows. One reprocessing pass runs in the background.
				{:else}
					Readings will be coordinated to {targetSiteName || siteName || 'the site'} using this sensor's calibration windows; a reprocessing pass runs in the background.
				{/if}
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			onclick={handleSubmit}
			disabled={working || (mode === 'site' ? !selectedSensorId : !selectedSiteId)}
		>{working ? 'Saving…' : movingFrom ? 'Move' : 'Deploy'}</Button>
	{/snippet}
</Dialog>
