<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api, type Sensor, type SensorCalibration } from '$api/crud';
	import { retagSensorFrequency } from '$api/service';
	import { me } from '$auth/me.svelte';
	import { formatDate } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';

	type FilterMode = 'all' | 'field' | 'lab';

	let sensors = $state<Sensor[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let currentPage = $state(1);
	let sortField = $state('name');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchQuery = $state('');
	let filterMode = $state<FilterMode>('all');

	// Parameter id → display name, loaded once for resolving curve parameters.
	let parameterNames = $state<Map<string, string>>(new Map());
	// Curve counts for every loaded sensor (bulk-loaded for the Curves column).
	let curveCountBySensor = $state<Map<string, number>>(new Map());

	// Bulk data-frequency reclassification (low = lab/campaign spot data, high = field stream).
	let selected = $state<Set<string>>(new Set());
	let retagBusy = $state(false);

	// Expanded rows + per-sensor curve cache (lazily fetched on first expand).
	let expanded = $state<Set<string>>(new Set());
	let curvesBySensor = $state<Map<string, SensorCalibration[]>>(new Map());
	let curvesLoading = $state<Set<string>>(new Set());

	const perPage = 25;

	async function load() {
		loading = true;
		error = null;
		try {
			const filter: Record<string, unknown> = {};
			if (filterMode === 'lab') filter.is_lab_instrument = true;
			else if (filterMode === 'field') filter.is_lab_instrument = false;

			const result = await api.sensors.list({
				page: currentPage,
				perPage,
				sort: [sortField, sortOrder],
				filter,
			});
			sensors = result.data;
			total = result.total;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load instruments';
		} finally {
			loading = false;
		}
	}

	// Curve counts are global (grouped by sensor), so they load once for the whole catalog.
	async function loadCurveCounts() {
		try {
			const res = await api.sensorCalibrations.list({ perPage: 1000, sort: ['sensor_id', 'ASC'] });
			const counts = new Map<string, number>();
			for (const c of res.data) counts.set(c.sensor_id, (counts.get(c.sensor_id) ?? 0) + 1);
			curveCountBySensor = counts;
		} catch {
			// Counts are non-critical; leave them blank rather than failing the whole page.
			curveCountBySensor = new Map();
		}
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
				`${res.sensors_updated} instrument${res.sensors_updated === 1 ? '' : 's'} marked ${freq}-frequency; existing readings are being retagged`,
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

	// Client-side search over the loaded page (the list itself is server-paginated).
	const displayed = $derived(
		sensors.filter((s) => {
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return (
				(s.name ?? '').toLowerCase().includes(q) ||
				(s.serial_number ?? '').toLowerCase().includes(q)
			);
		}),
	);

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
		await load();
	});
</script>

<svelte:head><title>Instruments | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Instruments</h2>
		{#if me.can('manageSensors')}
			<Button variant="primary" onclick={() => goto(`${base}/sensors/new`)}>New instrument</Button>
		{/if}
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
		<input
			type="text"
			placeholder="Search instruments…"
			bind:value={searchQuery}
			class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
	</div>

	{#if selected.size > 0 && me.can('manageSensors')}
		<div class="flex items-center gap-3 px-3 py-2 rounded-md border border-brand-divider bg-brand-bg text-sm">
			<span class="text-brand-muted">{selected.size} selected</span>
			<ConfirmPopover
				message="Mark {selected.size} instrument{selected.size === 1 ? '' : 's'} low-frequency? Their existing readings become spot data (shown as points, excluded from hourly/daily averages) and aggregates are refreshed."
				confirmLabel="Mark low-frequency"
				confirmVariant="primary"
				onconfirm={() => retagSelected('low')}
			>
				<Button size="sm" disabled={retagBusy}>Mark low-frequency</Button>
			</ConfirmPopover>
			<ConfirmPopover
				message="Mark {selected.size} instrument{selected.size === 1 ? '' : 's'} high-frequency? Their existing readings become continuous data and re-enter the hourly/daily averages."
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
					{#if me.can('manageSensors')}
						<th class="w-8 px-2 py-2">
							<input
								type="checkbox"
								checked={displayed.length > 0 && selected.size === displayed.length}
								onchange={toggleSelectAll}
								aria-label="Select all instruments"
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
					<th class="text-left px-4 py-2 font-semibold">Curves</th>
					<th class="text-left px-4 py-2 font-semibold">Active</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="10" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if displayed.length === 0}
					<tr><td colspan="10" class="px-4 py-8 text-center text-brand-muted">No instruments found</td></tr>
				{:else}
					{#each displayed as sensor}
						{@const isLab = sensor.is_lab_instrument === true}
						{@const isLow = sensor.data_frequency === 'low'}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							{#if me.can('manageSensors')}
								<td class="px-2 py-2 text-center">
									<input
										type="checkbox"
										checked={selected.has(sensor.id)}
										onchange={() => toggleSelected(sensor.id)}
										aria-label="Select {sensor.name ?? sensor.serial_number ?? 'instrument'}"
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
							<td class="px-4 py-2 text-brand-muted">{curveCountBySensor.get(sensor.id) ?? 0}</td>
							<td class="px-4 py-2">{sensor.is_active ? '✓' : 'None'}</td>
						</tr>
						{#if expanded.has(sensor.id)}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan="10" class="px-4 py-3">
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
										{#if me.can('manageSensors')}
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
