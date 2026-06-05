<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Sensor, type SensorDeployment, type SensorCalibration } from '$api/crud';
	import { getCalibrationCandidates, backfillCalibrations, type CalibrationBackfillCandidate } from '$api/service';
	import { formatRelativeTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

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
	let quickFilter = $state<'' | 'undeployed' | 'needs_cal'>('');

	let calBackfillBySensor = $state<Map<string, CalibrationBackfillCandidate>>(new Map());
	let totalUncalibrated = $state(0);
	let backfilling = $state<string | null>(null);

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
				deployments.length === 0 ? api.sensorDeployments.list({ perPage: 500, filter: { deployed_until: null } }) : Promise.resolve(null),
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

	async function loadCalBackfill() {
		try {
			const res = await getCalibrationCandidates();
			calBackfillBySensor = new Map(res.candidates.map((c) => [c.sensor_id, c]));
			totalUncalibrated = res.total_uncalibrated;
		} catch {
			calBackfillBySensor = new Map();
			totalUncalibrated = 0;
		}
	}

	async function runCalBackfill(body: { all?: boolean; sensor_id?: string }, key: string) {
		backfilling = key;
		try {
			const res = await backfillCalibrations(body);
			toastStore.success(
				`Backfilling calibrations for ${res.sensors_updated} sensor(s) — ~${res.estimated_readings.toLocaleString()} readings`
			);
			await loadCalBackfill();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Calibration backfill failed');
		} finally {
			backfilling = null;
		}
	}

	function currentDeployment(sensorId: string): SensorDeployment | undefined {
		return deployments.find((d) => d.sensor_id === sensorId && !d.deployed_until);
	}

	function calibrationCount(sensorId: string): number {
		return calibrations.filter((c) => c.sensor_id === sensorId).length;
	}

	// Client-side quick filters over the current page (the list is server-paginated).
	const filteredSensors = $derived(
		sensors.filter((s) => {
			if (quickFilter === 'undeployed') return !currentDeployment(s.id);
			if (quickFilter === 'needs_cal')
				return !calibrations.some((c) => c.sensor_id === s.id && !(c.slope === 1 && c.intercept === 0));
			return true;
		})
	);

	function toggleSort(field: string) {
		if (sortField === field) sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		else { sortField = field; sortOrder = 'ASC'; }
		currentPage = 1; load();
	}

	onMount(() => { load(); loadCalBackfill(); });
</script>

<svelte:head><title>Sensors | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Sensors</h2>
		<div class="flex items-center gap-2">
			{#if totalUncalibrated > 0}
				<ConfirmPopover
					message="Backfill calibrations for {totalUncalibrated.toLocaleString()} uncalibrated readings across all sensors?"
					confirmLabel="Backfill all"
					confirmVariant="primary"
					onconfirm={() => runCalBackfill({ all: true }, 'all')}
				>
					<button
						disabled={backfilling !== null}
						class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface hover:bg-brand-bg disabled:opacity-50"
					>{backfilling === 'all' ? 'Backfilling…' : `Backfill all (${totalUncalibrated.toLocaleString()})`}</button>
				</ConfirmPopover>
			{/if}
			<a href="{base}/sensors/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create</a>
		</div>
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
		<select bind:value={quickFilter} title="Applied within the current page"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
			<option value="">No quick filter</option>
			<option value="undeployed">Undeployed</option>
			<option value="needs_cal">Needs calibration</option>
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
				{:else if filteredSensors.length === 0}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">No sensors found</td></tr>
				{:else}
					{#each filteredSensors as sensor}
						{@const dep = currentDeployment(sensor.id)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2">
								<a href="{base}/sensors/{sensor.id}" class="text-brand-primary font-semibold no-underline hover:underline font-mono text-xs">{sensor.serial_number ?? '—'}</a>
							</td>
							<td class="px-4 py-2">{sensor.name ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted">{sensor.manufacturer ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted">{sensor.model ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{dep ? formatRelativeTime(dep.deployed_from) : 'Undeployed'}</td>
							<td class="px-4 py-2">
								<div class="flex items-center gap-1.5">
									<span class="text-xs text-brand-muted">{calibrationCount(sensor.id)} calibration{calibrationCount(sensor.id) === 1 ? '' : 's'}</span>
									{#if calBackfillBySensor.get(sensor.id)}
										{@const cb = calBackfillBySensor.get(sensor.id)!}
										<button
											onclick={() => runCalBackfill({ sensor_id: sensor.id }, sensor.id)}
											disabled={backfilling !== null}
											title="Backfill calibration for {cb.uncalibrated_count.toLocaleString()} uncalibrated readings"
											class="px-2 py-0.5 text-xs rounded bg-severity-warning-soft text-severity-warning cursor-pointer border-none hover:opacity-80 disabled:opacity-50 whitespace-nowrap"
										>{backfilling === sensor.id ? '…' : `Backfill (${cb.uncalibrated_count.toLocaleString()})`}</button>
									{/if}
								</div>
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
