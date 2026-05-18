<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Sensor, type SensorDeployment, type SensorCalibration } from '$api/crud';
	import { formatRelativeTime } from '$lib/utils';

	let sensors = $state<Sensor[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let calibrations = $state<SensorCalibration[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let currentPage = $state(1);
	let sortField = $state('name');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchQuery = $state('');
	let filterActive = $state<'' | 'true' | 'false'>('');

	const perPage = 25;
	const totalPages = $derived(Math.ceil(total / perPage));

	async function load() {
		loading = true;
		error = null;
		try {
			const filter: Record<string, unknown> = {};
			if (searchQuery) filter.q = searchQuery;
			if (filterActive) filter.is_active = filterActive === 'true';

			const [result, depResult, calResult] = await Promise.all([
				api.sensors.list({ page: currentPage, perPage, sort: [sortField, sortOrder], filter }),
				deployments.length === 0 ? api.sensorDeployments.list({ perPage: 500, filter: { deployed_until: '__null__' } }) : Promise.resolve(null),
				calibrations.length === 0 ? api.sensorCalibrations.list({ perPage: 500 }) : Promise.resolve(null),
			]);
			sensors = result.data;
			total = result.total;
			if (depResult) deployments = depResult.data;
			if (calResult) calibrations = calResult.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load sensors';
		} finally {
			loading = false;
		}
	}

	function currentDeployment(sensorId: string): SensorDeployment | undefined {
		return deployments.find((d) => d.sensor_id === sensorId && !d.deployed_until);
	}

	function lastCalibration(sensorId: string): SensorCalibration | undefined {
		return calibrations
			.filter((c) => c.sensor_id === sensorId)
			.sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime())[0];
	}

	function calibrationAge(cal: SensorCalibration | undefined): 'ok' | 'warning' | 'alarm' | 'unknown' {
		if (!cal) return 'unknown';
		const days = (Date.now() - new Date(cal.valid_from).getTime()) / 86400000;
		if (days < 30) return 'ok';
		if (days < 90) return 'warning';
		return 'alarm';
	}

	function toggleSort(field: string) {
		if (sortField === field) sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		else { sortField = field; sortOrder = 'ASC'; }
		currentPage = 1; load();
	}

	onMount(load);
</script>

<svelte:head><title>Sensors | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Sensors</h2>
		<a href="{base}/sensors/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create</a>
	</div>

	<div class="flex gap-3 items-center flex-wrap">
		<input type="text" placeholder="Search sensors..." bind:value={searchQuery} oninput={() => { currentPage = 1; load(); }}
			class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
		<select bind:value={filterActive} onchange={() => { currentPage = 1; load(); }}
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
			<option value="">All sensors</option>
			<option value="true">Active</option>
			<option value="false">Inactive</option>
		</select>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold cursor-pointer hover:text-brand-primary" onclick={() => toggleSort('serial_number')}>Serial {sortField === 'serial_number' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}</th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer hover:text-brand-primary" onclick={() => toggleSort('name')}>Name {sortField === 'name' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}</th>
					<th class="text-left px-4 py-2 font-semibold">Manufacturer</th>
					<th class="text-left px-4 py-2 font-semibold">Model</th>
					<th class="text-left px-4 py-2 font-semibold">Deployed At</th>
					<th class="text-left px-4 py-2 font-semibold">Calibration</th>
					<th class="text-left px-4 py-2 font-semibold">Active</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if error}
					<tr><td colspan="7" class="px-4 py-8 text-center text-severity-alarm">{error}</td></tr>
				{:else if sensors.length === 0}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">No sensors found</td></tr>
				{:else}
					{#each sensors as sensor}
						{@const dep = currentDeployment(sensor.id)}
						{@const cal = lastCalibration(sensor.id)}
						{@const calAge = calibrationAge(cal)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2">
								<a href="{base}/sensors/{sensor.id}" class="text-brand-primary font-semibold no-underline hover:underline font-mono text-xs">{sensor.serial_number ?? '—'}</a>
							</td>
							<td class="px-4 py-2">{sensor.name ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted">{sensor.manufacturer ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted">{sensor.model ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{dep ? formatRelativeTime(dep.deployed_from) : 'Undeployed'}</td>
							<td class="px-4 py-2">
								<span class="inline-block w-2 h-2 rounded-full mr-1 {calAge === 'ok' ? 'bg-severity-ok' : calAge === 'warning' ? 'bg-severity-warning' : calAge === 'alarm' ? 'bg-severity-alarm' : 'bg-severity-unknown'}"></span>
								<span class="text-xs text-brand-muted">{cal ? formatRelativeTime(cal.valid_from) : 'None'}</span>
							</td>
							<td class="px-4 py-2">{sensor.is_active ? '✓' : '—'}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between text-sm text-brand-muted">
			<span>{total} total</span>
			<div class="flex items-center gap-2">
				<button onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }} disabled={currentPage <= 1} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Prev</button>
				<span>{currentPage} / {totalPages}</span>
				<button onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }} disabled={currentPage >= totalPages} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Next</button>
			</div>
		</div>
	{/if}
</div>
