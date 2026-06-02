<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Sensor, type SensorCalibration, type SensorDeployment, type Site } from '$api/crud';
	import { recalibrateCalibration, rollbackDeployment } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import DeployMoveSensorDialog from '$components/dialogs/DeployMoveSensorDialog.svelte';

	let sensor = $state<Sensor | null>(null);
	let calibrations = $state<SensorCalibration[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let activeTab = $state(0);

	const sensorId = page.params.id!;

	// Add-calibration dialog
	let addCalOpen = $state(false);
	let newCalValidFrom = $state(new Date().toISOString().slice(0, 16));
	let newCalSlope = $state('1');
	let newCalIntercept = $state('0');
	let addingCal = $state(false);

	// Deploy / move dialog
	let deployOpen = $state(false);
	const currentDeployment = $derived(deployments.find((d) => !d.deployed_until));

	async function reloadDeployments() {
		const deps = await api.sensorDeployments.list({
			perPage: 100,
			filter: { sensor_id: sensorId },
			sort: ['deployed_from', 'DESC'],
		});
		deployments = deps.data;
	}

	async function reloadCalibrations() {
		const cals = await api.sensorCalibrations.list({
			perPage: 100,
			filter: { sensor_id: sensorId },
			sort: ['valid_from', 'DESC'],
		});
		calibrations = cals.data;
	}

	async function handleAddCalibration() {
		const slope = Number(newCalSlope);
		const intercept = Number(newCalIntercept);
		if (!Number.isFinite(slope) || slope === 0) {
			toastStore.error('Slope must be a non-zero number');
			return;
		}
		if (!Number.isFinite(intercept)) {
			toastStore.error('Intercept must be a number');
			return;
		}
		addingCal = true;
		try {
			await api.sensorCalibrations.create({
				sensor_id: sensorId,
				valid_from: new Date(newCalValidFrom).toISOString(),
				slope,
				intercept,
			});
			toastStore.success('Calibration added — readings will be recomputed in the background');
			addCalOpen = false;
			newCalSlope = '1';
			newCalIntercept = '0';
			newCalValidFrom = new Date().toISOString().slice(0, 16);
			await reloadCalibrations();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to add calibration');
		} finally {
			addingCal = false;
		}
	}

	onMount(async () => {
		try {
			const [s, cals, deps, sitesResult] = await Promise.all([
				api.sensors.get(sensorId),
				api.sensorCalibrations.list({ perPage: 100, filter: { sensor_id: sensorId }, sort: ['valid_from', 'DESC'] }),
				api.sensorDeployments.list({ perPage: 100, filter: { sensor_id: sensorId }, sort: ['deployed_from', 'DESC'] }),
				api.sites.list({ perPage: 200 }),
			]);
			sensor = s;
			calibrations = cals.data;
			deployments = deps.data;
			sites = sitesResult.data;
		} finally {
			loading = false;
		}
	});

	function siteName(siteId: string): string {
		return sites.find((s) => s.id === siteId)?.name ?? siteId;
	}

	async function handleRecalibrate(calId: string) {
		try {
			await recalibrateCalibration(calId);
			toastStore.success('Recalibration triggered');
		} catch { toastStore.error('Recalibration failed'); }
	}

	async function handleRollback(depId: string) {
		try {
			const result = await rollbackDeployment(depId);
			toastStore.success(`Rolled back: ${result.readings_reassigned} readings reassigned`);
			await reloadDeployments();
		} catch { toastStore.error('Rollback failed'); }
	}

	async function handleRecall(depId: string) {
		try {
			await api.sensorDeployments.update(depId, { deployed_until: new Date().toISOString() });
			toastStore.success('Sensor recalled — readings will be re-coordinated in the background');
			await reloadDeployments();
		} catch (e) { toastStore.error(e instanceof Error ? e.message : 'Recall failed'); }
	}
</script>

<svelte:head><title>{sensor?.name ?? sensor?.serial_number ?? 'Sensor'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if sensor}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<a href="{base}/sensors" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Sensors</a>
				<h2 class="text-xl font-semibold mt-1">{sensor.name ?? sensor.serial_number ?? 'Sensor'}</h2>
				{#if sensor.manufacturer || sensor.model}
					<p class="text-sm text-brand-muted">{[sensor.manufacturer, sensor.model].filter(Boolean).join(' ')}</p>
				{/if}
				{#if currentDeployment}
					<p class="text-sm mt-0.5">Currently at <a href="{base}/sites/{currentDeployment.site_id}" class="text-brand-primary no-underline hover:underline">{siteName(currentDeployment.site_id)}</a> since {formatDateTime(currentDeployment.deployed_from)}</p>
				{:else}
					<p class="text-sm mt-0.5 text-brand-muted">Not currently deployed</p>
				{/if}
			</div>
			<div class="flex gap-2 items-center">
				<button onclick={() => (deployOpen = true)} class="px-3 py-1 text-sm border border-brand-divider rounded-md cursor-pointer bg-brand-surface hover:bg-brand-bg">Deploy / Move…</button>
				<span class="px-2 py-0.5 text-xs font-medium rounded-full {sensor.is_active ? 'bg-severity-ok-soft text-severity-ok' : 'bg-brand-bg text-brand-muted'}">
					{sensor.is_active ? 'Active' : 'Inactive'}
				</span>
			</div>
		</div>

		<Tabs tabs={['Overview', 'Deployments', 'Calibrations']} bind:active={activeTab} />

		{#if activeTab === 0}
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div><span class="text-brand-muted block">Serial Number</span><span class="font-mono">{sensor.serial_number ?? '—'}</span></div>
					<div><span class="text-brand-muted block">Name</span>{sensor.name ?? '—'}</div>
					<div><span class="text-brand-muted block">Manufacturer</span>{sensor.manufacturer ?? '—'}</div>
					<div><span class="text-brand-muted block">Model</span>{sensor.model ?? '—'}</div>
				</div>
				{#if sensor.description}
					<div><span class="text-sm text-brand-muted block">Description</span><p class="text-sm">{sensor.description}</p></div>
				{/if}
			</div>
		{:else if activeTab === 1}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Site</th>
						<th class="text-left px-4 py-2 font-semibold">From</th>
						<th class="text-left px-4 py-2 font-semibold">Until</th>
						<th class="text-left px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each deployments as dep}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2"><a href="{base}/sites/{dep.site_id}" class="text-brand-primary no-underline hover:underline">{siteName(dep.site_id)}</a></td>
								<td class="px-4 py-2 text-xs text-brand-muted">{formatDateTime(dep.deployed_from)}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{dep.deployed_until ? formatDateTime(dep.deployed_until) : 'Current'}</td>
								<td class="px-4 py-2">
									{#if !dep.deployed_until}
										<div class="flex gap-3">
											<ConfirmPopover message="End this deployment now? The sensor will be marked as no longer in the field." confirmLabel="Recall" confirmVariant="primary" onconfirm={() => handleRecall(dep.id)}>
												<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Recall</button>
											</ConfirmPopover>
											<ConfirmPopover message="Roll back this deployment? This deletes it and restores the previous one." confirmLabel="Rollback" onconfirm={() => handleRollback(dep.id)}>
												<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Rollback</button>
											</ConfirmPopover>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
						{#if deployments.length === 0}
							<tr><td colspan="4" class="px-4 py-6 text-center text-brand-muted">No deployments</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		{:else if activeTab === 2}
			<div class="flex justify-end mb-2">
				<button onclick={() => addCalOpen = true} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none">+ Add Calibration</button>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Valid From</th>
						<th class="text-left px-4 py-2 font-semibold">Valid Until</th>
						<th class="text-left px-4 py-2 font-semibold">Slope</th>
						<th class="text-left px-4 py-2 font-semibold">Intercept</th>
						<th class="text-left px-4 py-2 font-semibold">Equation</th>
						<th class="text-left px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each calibrations as cal}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2 text-xs">{formatDateTime(cal.valid_from)}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{cal.valid_until ? formatDateTime(cal.valid_until) : '—'}</td>
								<td class="px-4 py-2 font-mono text-xs">{cal.slope}</td>
								<td class="px-4 py-2 font-mono text-xs">{cal.intercept}</td>
								<td class="px-4 py-2 font-mono text-xs">y = {cal.slope}x + {cal.intercept}</td>
								<td class="px-4 py-2">
									<ConfirmPopover message="Recalibrate readings?" confirmLabel="Recalibrate" confirmVariant="primary" onconfirm={() => handleRecalibrate(cal.id)}>
										<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Recalibrate</button>
									</ConfirmPopover>
								</td>
							</tr>
						{/each}
						{#if calibrations.length === 0}
							<tr><td colspan="6" class="px-4 py-6 text-center text-brand-muted">No calibrations</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<Dialog bind:open={addCalOpen} title="Add Calibration" maxWidth="sm">
		{#snippet children()}
			<div class="space-y-3">
				<div class="flex flex-col gap-1">
					<label for="cal-valid-from" class="text-xs text-brand-muted">Valid from</label>
					<input id="cal-valid-from" type="datetime-local" bind:value={newCalValidFrom} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label for="cal-slope" class="text-xs text-brand-muted">Slope (m)</label>
						<input id="cal-slope" type="number" step="any" bind:value={newCalSlope} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div class="flex flex-col gap-1">
						<label for="cal-intercept" class="text-xs text-brand-muted">Intercept (b)</label>
						<input id="cal-intercept" type="number" step="any" bind:value={newCalIntercept} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
				<p class="text-xs text-brand-muted">Calibrated value = slope &times; raw + intercept. Adding this calibration will recompute existing readings in its time window in the background.</p>
			</div>
		{/snippet}
		{#snippet actions()}
			<button onclick={() => addCalOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
			<button onclick={handleAddCalibration} disabled={addingCal} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{addingCal ? 'Adding...' : 'Add'}</button>
		{/snippet}
	</Dialog>

	<DeployMoveSensorDialog
		bind:open={deployOpen}
		mode="sensor"
		sensorId={sensor.id}
		sensorName={sensor.name ?? sensor.serial_number ?? 'sensor'}
		sites={sites}
		currentSiteName={currentDeployment ? siteName(currentDeployment.site_id) : ''}
		onsuccess={reloadDeployments}
	/>
{/if}
