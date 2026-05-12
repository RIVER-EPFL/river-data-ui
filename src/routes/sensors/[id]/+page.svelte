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

	let sensor = $state<Sensor | null>(null);
	let calibrations = $state<SensorCalibration[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let activeTab = $state(0);

	const sensorId = page.params.id!;

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
		} catch { toastStore.error('Rollback failed'); }
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
			</div>
			<div class="flex gap-2 items-center">
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
										<ConfirmPopover message="Rollback this deployment?" confirmLabel="Rollback" onconfirm={() => handleRollback(dep.id)}>
											<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Rollback</button>
										</ConfirmPopover>
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
{/if}
