<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Sensor, type SensorDeployment, type SensorCalibration } from '$api/crud';
	import {
		retagSensorFrequency,
		getCalibrationCandidates,
		backfillCalibrations,
		type CalibrationBackfillCandidate,
	} from '$api/service';
	import { me } from '$auth/me.svelte';
	import { formatDate, formatRelativeTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';

	type FilterMode = 'all' | 'field' | 'lab';

	let sensors = $state<Sensor[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let currentPage = $state(1);
	let sortField = $state('name');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchQuery = $state('');
	let filterActive = $state<'' | 'true' | 'false'>('');
	let quickFilter = $state<'' | 'undeployed' | 'needs_cal'>('');
	// The Field/Lab chip is deep-linkable (?type=lab|field) so the old /instruments URL forwards here.
	const initialType = page.url.searchParams.get('type');
	let filterMode = $state<FilterMode>(initialType === 'lab' || initialType === 'field' ? initialType : 'all');

	// Parameter id → display name, loaded once for resolving curve parameters.
	let parameterNames = $state<Map<string, string>>(new Map());
	// All curves, loaded once: drives the Curves column counts and the needs-calibration filter.
	let allCalibrations = $state<SensorCalibration[]>([]);
	let curveCountBySensor = $state<Map<string, number>>(new Map());

	// Bulk data-frequency reclassification (low = lab/campaign spot data, high = field stream).
	let selected = $state<Set<string>>(new Set());
	let retagBusy = $state(false);

	// Expanded rows + per-sensor curve cache (lazily fetched on first expand).
	let expanded = $state<Set<string>>(new Set());
	let curvesBySensor = $state<Map<string, SensorCalibration[]>>(new Map());
	let curvesLoading = $state<Set<string>>(new Set());

	// Calibration backfill: readings that predate their sensor's first real calibration.
	let calBackfillBySensor = $state<Map<string, CalibrationBackfillCandidate>>(new Map());
	let totalUncalibrated = $state(0);
	let backfilling = $state<string | null>(null);

	const perPage = 25;

	async function load() {
		loading = true;
		error = null;
		try {
			const filter: Record<string, unknown> = {};
			if (searchQuery) filter.q = searchQuery;
			if (filterActive) filter.is_active = filterActive === 'true';
			if (filterMode === 'lab') filter.is_lab_instrument = true;
			else if (filterMode === 'field') filter.is_lab_instrument = false;

			const [result, depResult] = await Promise.all([
				api.sensors.list({ page: currentPage, perPage, sort: [sortField, sortOrder], filter }),
				deployments.length === 0
					? api.sensorDeployments.list({ perPage: 500, filter: { deployed_until: null } })
					: Promise.resolve(null),
			]);
			sensors = result.data;
			total = result.total;
			if (depResult) deployments = depResult.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load sensors';
		} finally {
			loading = false;
		}
	}

	// Curves are global (grouped by sensor), so they load once for the whole catalog.
	async function loadCurveCounts() {
		try {
			const res = await api.sensorCalibrations.list({ perPage: 1000, sort: ['sensor_id', 'ASC'] });
			allCalibrations = res.data;
			const counts = new Map<string, number>();
			for (const c of res.data) counts.set(c.sensor_id, (counts.get(c.sensor_id) ?? 0) + 1);
			curveCountBySensor = counts;
		} catch {
			// Counts are non-critical; leave them blank rather than failing the whole page.
			allCalibrations = [];
			curveCountBySensor = new Map();
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
				`Backfilling calibrations for ${res.sensors_updated} sensor(s) - ~${res.estimated_readings.toLocaleString()} readings`
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

	async function toggleExpand(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
			if (!curvesBySensor.has(id)) void loadCurves(id);
		}
		expanded = next;
	}

	async function loadCurves(id: string) {
		const loadingNext = new Set(curvesLoading);
		loadingNext.add(id);
		curvesLoading = loadingNext;
		try {
			const res = await api.sensorCalibrations.list({
				perPage: 200,
				filter: { sensor_id: id },
				sort: ['valid_from', 'DESC'],
			});
			const cache = new Map(curvesBySensor);
			cache.set(id, res.data);
			curvesBySensor = cache;
		} catch {
			const cache = new Map(curvesBySensor);
			cache.set(id, []);
			curvesBySensor = cache;
		} finally {
			const done = new Set(curvesLoading);
			done.delete(id);
			curvesLoading = done;
		}
	}

	function toggleSelected(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function toggleSelectAll() {
		selected = selected.size === displayed.length ? new Set() : new Set(displayed.map((s) => s.id));
	}

	async function retagSelected(freq: 'high' | 'low') {
		retagBusy = true;
		try {
			const res = await retagSensorFrequency([...selected], freq, true);
			toastStore.success(
				`${res.sensors_updated} sensor${res.sensors_updated === 1 ? '' : 's'} marked ${freq}-frequency; existing readings are being retagged`,
			);
			selected = new Set();
			await load();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Reclassification failed');
		} finally {
			retagBusy = false;
		}
	}

	function setFilter(mode: FilterMode) {
		filterMode = mode;
		currentPage = 1;
		load();
	}

	function toggleSort(field: string) {
		if (sortField === field) sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		else {
			sortField = field;
			sortOrder = 'ASC';
		}
		currentPage = 1;
		load();
	}

	// Client-side quick filters over the current page (the list itself is server-paginated).
	const displayed = $derived(
		sensors.filter((s) => {
			if (quickFilter === 'undeployed') return !currentDeployment(s.id);
			if (quickFilter === 'needs_cal')
				return !allCalibrations.some((c) => c.sensor_id === s.id && !(c.slope === 1 && c.intercept === 0));
			return true;
		}),
	);

	const canManage = $derived(me.can('manageSensors'));
	const columnCount = $derived(canManage ? 11 : 10);

	const filterChips: { mode: FilterMode; label: string }[] = [
		{ mode: 'all', label: 'All' },
		{ mode: 'field', label: 'Field' },
		{ mode: 'lab', label: 'Lab' },
	];

	onMount(async () => {
		try {
			const params = await api.parameters.list({ perPage: 1000, sort: ['code', 'ASC'] });
			parameterNames = new Map(params.data.map((p) => [p.id, p.name]));
		} catch {
			parameterNames = new Map();
		}
		void loadCurveCounts();
		void loadCalBackfill();
		await load();
	});
</script>

<svelte:head><title>Sensors & Instruments | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Sensors & Instruments</h2>
		<div class="flex items-center gap-2">
			{#if totalUncalibrated > 0}
				<ConfirmPopover
					message="Backfill calibrations for {totalUncalibrated.toLocaleString()} uncalibrated readings across all sensors?"
					confirmLabel="Backfill all"
					confirmVariant="primary"
					onconfirm={() => runCalBackfill({ all: true }, 'all')}
				>
					<Button
						disabled={backfilling !== null}
					>{backfilling === 'all' ? 'Backfilling…' : `Backfill all (${totalUncalibrated.toLocaleString()})`}</Button>
				</ConfirmPopover>
			{/if}
			<a href="{base}/sensors/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create</a>
		</div>
	</div>

	<div class="flex gap-3 items-center flex-wrap">
		<div class="flex gap-0.5">
			{#each filterChips as chip}
				<button
					onclick={() => setFilter(chip.mode)}
					class="px-3 py-1.5 text-sm rounded cursor-pointer border-none {filterMode === chip.mode
						? 'bg-brand-primary text-white'
						: 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
				>{chip.label}</button>
			{/each}
		</div>
		<input type="text" placeholder="Search sensors…" bind:value={searchQuery} oninput={() => { currentPage = 1; load(); }}
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

	{#if selected.size > 0 && canManage}
		<div class="flex items-center gap-3 px-3 py-2 rounded-md border border-brand-divider bg-brand-bg text-sm">
			<span class="text-brand-muted">{selected.size} selected</span>
			<ConfirmPopover
				message="Mark {selected.size} sensor{selected.size === 1 ? '' : 's'} low-frequency? Their existing readings become spot data (shown as points, excluded from hourly/daily averages) and aggregates are refreshed."
				confirmLabel="Mark low-frequency"
				confirmVariant="primary"
				onconfirm={() => retagSelected('low')}
			>
				<Button size="sm" disabled={retagBusy}>Mark low-frequency</Button>
			</ConfirmPopover>
			<ConfirmPopover
				message="Mark {selected.size} sensor{selected.size === 1 ? '' : 's'} high-frequency? Their existing readings become continuous data and re-enter the hourly/daily averages."
				confirmLabel="Mark high-frequency"
				confirmVariant="primary"
				onconfirm={() => retagSelected('high')}
			>
				<Button size="sm" disabled={retagBusy}>Mark high-frequency</Button>
			</ConfirmPopover>
			<Button size="sm" variant="ghost" onclick={() => (selected = new Set())}>Clear</Button>
		</div>
	{/if}

	{#if error}
		<ErrorNotice message={error} />
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					{#if canManage}
						<th class="w-8 px-2 py-2">
							<input
								type="checkbox"
								checked={displayed.length > 0 && selected.size === displayed.length}
								onchange={toggleSelectAll}
								aria-label="Select all sensors"
							/>
						</th>
					{/if}
					<th class="w-8 px-2 py-2"></th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer hover:text-brand-primary" onclick={() => toggleSort('serial_number')}>Serial {sortField === 'serial_number' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}</th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer hover:text-brand-primary" onclick={() => toggleSort('name')}>Name {sortField === 'name' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}</th>
					<th class="text-left px-4 py-2 font-semibold">Type</th>
					<th class="text-left px-4 py-2 font-semibold cursor-pointer hover:text-brand-primary" onclick={() => toggleSort('data_frequency')}>Frequency {sortField === 'data_frequency' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}</th>
					<th class="text-left px-4 py-2 font-semibold">Manufacturer</th>
					<th class="text-left px-4 py-2 font-semibold">Model</th>
					<th class="text-left px-4 py-2 font-semibold">Deployed At</th>
					<th class="text-left px-4 py-2 font-semibold">Curves</th>
					<th class="text-left px-4 py-2 font-semibold">Active</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan={columnCount} class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if displayed.length === 0}
					<tr><td colspan={columnCount} class="px-4 py-8 text-center text-brand-muted">No sensors found</td></tr>
				{:else}
					{#each displayed as sensor}
						{@const isLab = sensor.is_lab_instrument === true}
						{@const isLow = sensor.data_frequency === 'low'}
						{@const dep = currentDeployment(sensor.id)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							{#if canManage}
								<td class="px-2 py-2 text-center">
									<input
										type="checkbox"
										checked={selected.has(sensor.id)}
										onchange={() => toggleSelected(sensor.id)}
										aria-label="Select {sensor.name ?? sensor.serial_number ?? 'sensor'}"
									/>
								</td>
							{/if}
							<td class="px-2 py-2 text-center">
								<button
									onclick={() => toggleExpand(sensor.id)}
									class="text-brand-muted hover:text-brand-primary cursor-pointer bg-transparent border-none px-1"
									aria-label={expanded.has(sensor.id) ? 'Collapse curves' : 'Expand curves'}
								>{expanded.has(sensor.id) ? '▾' : '▸'}</button>
							</td>
							<td class="px-4 py-2">
								<a href="{base}/sensors/{sensor.id}" class="text-brand-primary font-semibold no-underline hover:underline font-mono text-xs">{sensor.serial_number ?? 'None'}</a>
							</td>
							<td class="px-4 py-2">{sensor.name ?? 'None'}</td>
							<td class="px-4 py-2">
								<Badge variant={isLab ? 'accent' : 'default'}>{isLab ? 'Lab' : 'Field'}</Badge>
							</td>
							<td class="px-4 py-2">
								<Badge variant={isLow ? 'accent' : 'muted'}>{isLow ? 'Low' : 'High'}</Badge>
							</td>
							<td class="px-4 py-2 text-brand-muted">{sensor.manufacturer ?? 'None'}</td>
							<td class="px-4 py-2 text-brand-muted">{sensor.model ?? 'None'}</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{dep ? formatRelativeTime(dep.deployed_from) : 'Undeployed'}</td>
							<td class="px-4 py-2">
								<div class="flex items-center gap-1.5">
									<span class="text-brand-muted">{curveCountBySensor.get(sensor.id) ?? 0}</span>
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
							<td class="px-4 py-2">{sensor.is_active ? '✓' : 'None'}</td>
						</tr>
						{#if expanded.has(sensor.id)}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan={columnCount} class="px-4 py-3">
									{#if curvesLoading.has(sensor.id) && !curvesBySensor.has(sensor.id)}
										<p class="text-xs text-brand-muted">Loading…</p>
									{:else}
										{@const curves = curvesBySensor.get(sensor.id) ?? []}
										{#if curves.length === 0}
											<p class="text-xs text-brand-muted">No curves</p>
										{:else}
											<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
												<table class="w-full text-xs">
													<thead><tr class="bg-brand-bg border-b border-brand-divider">
														<th class="text-left px-3 py-1.5 font-semibold">Name</th>
														<th class="text-left px-3 py-1.5 font-semibold">Mode</th>
														<th class="text-left px-3 py-1.5 font-semibold">Parameter</th>
														<th class="text-left px-3 py-1.5 font-semibold">Valid From</th>
														<th class="text-left px-3 py-1.5 font-semibold">Slope</th>
														<th class="text-left px-3 py-1.5 font-semibold">Intercept</th>
														<th class="text-left px-3 py-1.5 font-semibold">R²</th>
														<th class="text-left px-3 py-1.5 font-semibold">Equation</th>
													</tr></thead>
													<tbody>
														{#each curves as cal}
															<tr class="border-b border-brand-divider last:border-b-0">
																<td class="px-3 py-1.5">{cal.name ?? '—'}</td>
																<td class="px-3 py-1.5"><Badge variant={cal.mode === 'instant' ? 'accent' : 'muted'}>{cal.mode}</Badge></td>
																<td class="px-3 py-1.5 text-brand-muted">{parameterNames.get(cal.parameter_id ?? '') ?? ''}</td>
																<td class="px-3 py-1.5 text-brand-muted">{formatDate(cal.valid_from)}</td>
																<td class="px-3 py-1.5 font-mono">{cal.slope}</td>
																<td class="px-3 py-1.5 font-mono">{cal.intercept}</td>
																<td class="px-3 py-1.5 font-mono">{cal.r_squared?.toFixed(4) ?? '—'}</td>
																<td class="px-3 py-1.5 font-mono">y = {cal.slope}x + {cal.intercept}</td>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
										{#if canManage}
											<div class="mt-2">
												<a href="{base}/sensor-calibrations/new?sensor_id={sensor.id}" class="text-xs text-brand-primary no-underline hover:underline">+ Add curve</a>
											</div>
										{/if}
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls {total} page={currentPage} {perPage} onPageChange={(p) => { currentPage = p; load(); }} />
</div>
