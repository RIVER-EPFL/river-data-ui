<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Sensor, type SensorDeployment, type SensorCalibration } from '$api/crud';
	import {
		retagSensorFrequency,
		getCalibrationCandidates,
		backfillCalibrations,
		getUnpairedSummary,
		type CalibrationBackfillCandidate,
	} from '$api/service';
	import { me } from '$auth/me.svelte';
	import { formatDate, formatRelativeTime } from '$lib/utils';
	import { formatEquation } from '$lib/standardCurves';
	import { isBookkeeping, kindLabel } from '$lib/instruments/kind';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import CountList from '$components/ui/CountList.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import OriginBadge from '$components/crud/OriginBadge.svelte';
	import OriginFilter from '$components/crud/OriginFilter.svelte';
	import { originFilter, type Origin } from '$lib/origin';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';
	import { formatCount } from '$lib/format';

	type FilterMode = 'all' | 'field' | 'lab' | 'source_parameter' | 'entry_channel';

	let sensors = $state<Sensor[]>([]);
	let deployments = $state<SensorDeployment[]>([]);
	let list = $state<ReturnType<typeof CrudList> | null>(null);
	let searchQuery = $state('');
	let filterActive = $state<'' | 'true' | 'false'>('');
	let origin = $state<Origin>('any');
	// The source systems that exist, so the origin filter offers the ones a row can actually name.
	let sourceSystems = $state<string[]>([]);
	let quickFilter = $state<'' | 'undeployed' | 'no_curves'>('');
	// The Field/Lab chip is deep-linkable (?type=lab|field) so the old /instruments URL forwards here.
	const initialType = page.url.searchParams.get('type');
	let filterMode = $state<FilterMode>(initialType === 'lab' || initialType === 'field' ? initialType : 'all');

	// Parameter id → display name, loaded once for resolving curve parameters.
	let parameterNames = $state<Map<string, string>>(new Map());
	// All curves, loaded once: drives the Curves column counts and the no-curves filter.
	let curveCountBySensor = $state<Map<string, number>>(new Map());

	// Bulk data-frequency reclassification (low = lab/campaign spot data, high = field stream).
	let selected = $state<Set<string>>(new Set());
	let retagBusy = $state(false);

	// Expanded rows + per-sensor curve cache (lazily fetched on first expand).
	let expanded = $state<Set<string>>(new Set());
	let curvesBySensor = $state<Map<string, SensorCalibration[]>>(new Map());
	let curvesLoading = $state<Set<string>>(new Set());

	// Readings a calibration window covers that were never stamped with it, per sensor. Reprocessing
	// resolves them against the curves that already exist.
	let calBackfillBySensor = $state<Map<string, CalibrationBackfillCandidate>>(new Map());
	let totalUncalibrated = $state(0);
	let totalOrphanedCorrections = $state(0);
	let backfilling = $state<string | null>(null);

	const perPage = 25;

	async function loadSensors({ page: p, perPage: pp, sort }: PageRequest) {
		const filter: Record<string, unknown> = { ...originFilter(origin, 'source_system') };
		if (searchQuery) filter.q = searchQuery;
		if (filterActive) filter.is_active = filterActive === 'true';
		if (filterMode === 'field') filter.kind = 'device';
		else if (filterMode === 'lab') filter.kind = 'lab';
		else if (filterMode !== 'all') filter.kind = filterMode;

		const [result, depResult] = await Promise.all([
			api.sensors.list({ page: p, perPage: pp, sort, filter }),
			deployments.length === 0
				? api.sensorDeployments.list({ perPage: 500, filter: { deployed_until: null } })
				: Promise.resolve(null),
		]);
		sensors = result.data;
		if (depResult) deployments = depResult.data;
		// The quick filters narrow the page that was fetched, not the query behind it.
		return { data: displayed, total: result.total };
	}

	// Curves are global (grouped by sensor), so they load once for the whole catalog.
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

	async function loadCalBackfill() {
		try {
			const res = await getCalibrationCandidates();
			calBackfillBySensor = new Map(res.candidates.map((c) => [c.sensor_id, c]));
			totalUncalibrated = res.total_uncalibrated;
			totalOrphanedCorrections = res.total_orphaned_corrections;
		} catch {
			calBackfillBySensor = new Map();
			totalUncalibrated = 0;
			totalOrphanedCorrections = 0;
		}
	}

	async function runCalBackfill(body: { all?: boolean; sensor_id?: string }, key: string) {
		backfilling = key;
		try {
			const res = await backfillCalibrations(body);
			toastStore.success(
				`Reprocessing ${res.sensors_updated} sensor(s) - ~${formatCount(res.estimated_readings)} readings resolve against their existing curves`
			);
			await loadCalBackfill();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Reprocessing failed');
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
			list?.refresh();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Reclassification failed');
		} finally {
			retagBusy = false;
		}
	}

	function setFilter(mode: FilterMode) {
		filterMode = mode;
		list?.reload();
	}

	// Client-side quick filters over the current page (the list itself is server-paginated).
	const displayed = $derived(
		sensors.filter((s) => {
			if (quickFilter === 'undeployed') return !currentDeployment(s.id);
			if (quickFilter === 'no_curves') return (curveCountBySensor.get(s.id) ?? 0) === 0;
			return true;
		}),
	);

	const canManage = $derived(me.can('manageSensors'));

	const columns: Column[] = [
		{ key: 'expand', label: '', sortable: false, class: 'w-8 px-2 text-center' },
		{ key: 'serial_number', label: 'Serial' },
		{ key: 'name', label: 'Name' },
		{ key: 'kind', label: 'Type', sortable: false },
		{ key: 'data_frequency', label: 'Frequency' },
		{ key: 'manufacturer', label: 'Manufacturer', sortable: false, class: 'text-brand-muted' },
		{ key: 'model', label: 'Model', sortable: false, class: 'text-brand-muted' },
		{ key: 'deployed_at', label: 'Deployed At', sortable: false, class: 'text-brand-muted text-xs' },
		{ key: 'curves', label: 'Curves', sortable: false },
		{ key: 'is_active', label: 'Active', sortable: false },
	];
	const listColumns = $derived(
		canManage
			? [{ key: 'select', label: '', sortable: false, class: 'w-8 px-2 text-center' }, ...columns]
			: columns,
	);

	// The four kinds a row can be: two instruments something was measured on, two bookkeeping rows
	// minted so a reading can name what it came through.
	const filterChips: { mode: FilterMode; label: string }[] = [
		{ mode: 'all', label: 'All' },
		{ mode: 'field', label: 'Field' },
		{ mode: 'lab', label: 'Lab' },
		{ mode: 'source_parameter', label: 'Source parameter' },
		{ mode: 'entry_channel', label: 'Entry channel' },
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
		try {
			sourceSystems = (await getUnpairedSummary()).map((r) => r.source_system);
		} catch {
			sourceSystems = [];
		}
	});
</script>

<svelte:head><title>Sensors & Instruments | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Sensors & Instruments</h2>
		<div class="flex items-center gap-2">
			{#if totalUncalibrated > 0}
				<ConfirmPopover
					message="Reprocess every sensor with readings a calibration window covers but never stamped? Existing curves apply; no curve is created."
					confirmLabel="Reprocess all"
					confirmVariant="primary"
					onconfirm={() => runCalBackfill({ all: true }, 'all')}
				>
					{#snippet detail()}
						<CountList rows={[{ label: 'Readings resolved', value: formatCount(totalUncalibrated) }]} />
					{/snippet}
					<Button
						disabled={backfilling !== null}
					>{backfilling === 'all' ? 'Reprocessing…' : `Reprocess all (${formatCount(totalUncalibrated)})`}</Button>
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
		<input type="text" placeholder="Search sensors…" bind:value={searchQuery} oninput={() => list?.reload()}
			class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
		<select bind:value={filterActive} onchange={() => list?.reload()}
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
			<option value="">All sensors</option>
			<option value="true">Active</option>
			<option value="false">Inactive</option>
		</select>
		<OriginFilter bind:value={origin} sources={sourceSystems} onchange={() => list?.reload()} />
		<select bind:value={quickFilter} onchange={() => list?.refresh()} title="Applied within the current page"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
			<option value="">No quick filter</option>
			<option value="undeployed">Undeployed</option>
			<option value="no_curves" title="Sensors no calibration has been entered for. Counted from the first 1000 curves, so a sensor beyond that page reads as having none.">No curves recorded</option>
		</select>
	</div>

	{#if totalOrphanedCorrections > 0}
		<p class="text-xs text-brand-muted">
			{formatCount(totalOrphanedCorrections)} reading{totalOrphanedCorrections === 1 ? '' : 's'} carry a corrected value that names no curve. Reported only - the stored number is a measurement and is left as it is.
		</p>
	{/if}

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

	<CrudList
		bind:this={list}
		load={loadSensors}
		columns={listColumns}
		title="Sensors"
		showHeader={false}
		{perPage}
		defaultSort={['name', 'ASC']}
		emptyText="No sensors found"
	>
		{#snippet header({ column, label }: { column: Column; label: string })}
			{#if column.key === 'select'}
				<input
					type="checkbox"
					checked={displayed.length > 0 && selected.size === displayed.length}
					onchange={toggleSelectAll}
					aria-label="Select all sensors"
				/>
			{:else}
				{label}
			{/if}
		{/snippet}

		{#snippet cell({ column, row, text }: { column: Column; row: Sensor; text: string })}
			{#if column.key === 'select'}
				<input
					type="checkbox"
					checked={selected.has(row.id)}
					onchange={() => toggleSelected(row.id)}
					aria-label="Select {row.name ?? row.serial_number ?? 'sensor'}"
				/>
			{:else if column.key === 'expand'}
				<button
					onclick={() => toggleExpand(row.id)}
					class="text-brand-muted hover:text-brand-primary cursor-pointer bg-transparent border-none px-1"
					aria-label={expanded.has(row.id) ? 'Collapse curves' : 'Expand curves'}
				>{expanded.has(row.id) ? '▾' : '▸'}</button>
			{:else if column.key === 'serial_number'}
				<a href="{base}/sensors/{row.id}" class="text-brand-primary font-semibold no-underline hover:underline font-mono text-xs">{row.serial_number ?? 'None'}</a>
			{:else if column.key === 'name'}
				{row.name ?? 'None'}
			{:else if column.key === 'kind'}
				<Badge variant={isBookkeeping(row) ? 'default' : row.is_lab_instrument === true ? 'accent' : 'default'}>{kindLabel(row)}</Badge>
				<OriginBadge sourceSystem={row.source_system} />
			{:else if column.key === 'data_frequency'}
				{@const isLow = row.data_frequency === 'low'}
				<Badge variant={isLow ? 'accent' : 'muted'}>{isLow ? 'Low' : 'High'}</Badge>
			{:else if column.key === 'manufacturer'}
				{row.manufacturer ?? 'None'}
			{:else if column.key === 'model'}
				{row.model ?? 'None'}
			{:else if column.key === 'deployed_at'}
				{@const dep = currentDeployment(row.id)}
				{dep ? formatRelativeTime(dep.deployed_from) : 'Undeployed'}
			{:else if column.key === 'curves'}
				<div class="flex items-center gap-1.5">
					<span class="text-brand-muted">{curveCountBySensor.get(row.id) ?? 0}</span>
					{#if calBackfillBySensor.get(row.id)}
						{@const cb = calBackfillBySensor.get(row.id)!}
						<Button
							size="sm"
							variant="ghost"
							class="text-brand-primary whitespace-nowrap"
							onclick={() => runCalBackfill({ sensor_id: row.id }, row.id)}
							disabled={backfilling !== null}
							title="{formatCount(cb.uncalibrated_count)} reading(s) sit inside one of this sensor's calibration windows but were never stamped with it. Reprocessing resolves them; no curve is created."
						>{backfilling === row.id ? '…' : `Reprocess (${formatCount(cb.uncalibrated_count)})`}</Button>
					{/if}
				</div>
			{:else if column.key === 'is_active'}
				{row.is_active ? '✓' : 'None'}
			{:else}
				{text}
			{/if}
		{/snippet}

		{#snippet rowDetail({ row, colCount }: { row: Sensor; colCount: number })}
			{#if expanded.has(row.id)}
				<tr class="border-b border-brand-divider bg-brand-bg/40">
					<td colspan={colCount} class="px-4 py-3">
						{#if curvesLoading.has(row.id) && !curvesBySensor.has(row.id)}
							<p class="text-xs text-brand-muted">Loading…</p>
						{:else}
							{@const curves = curvesBySensor.get(row.id) ?? []}
							{#if curves.length === 0}
								<p class="text-xs text-brand-muted">No curves recorded - this instrument's readings are served uncorrected.</p>
							{:else}
								<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
									<table class="w-full text-xs">
										<thead><tr class="bg-brand-bg border-b border-brand-divider">
											<th class="text-left px-3 py-1.5 font-semibold">Name</th>
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
													<td class="px-3 py-1.5">{cal.name ?? '-'}</td>
													<td class="px-3 py-1.5 text-brand-muted">{parameterNames.get(cal.parameter_id ?? '') ?? ''}</td>
													<td class="px-3 py-1.5 text-brand-muted">{formatDate(cal.valid_from)}</td>
													<td class="px-3 py-1.5 font-mono">{cal.slope}</td>
													<td class="px-3 py-1.5 font-mono">{cal.intercept}</td>
													<td class="px-3 py-1.5 font-mono">{cal.r_squared?.toFixed(4) ?? '-'}</td>
													<td class="px-3 py-1.5 font-mono">{formatEquation(cal.slope, cal.intercept)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
							{#if canManage}
								<div class="mt-2">
									<a href="{base}/sensor-calibrations/new?sensor_id={row.id}" class="text-xs text-brand-primary no-underline hover:underline">+ Add curve</a>
								</div>
							{/if}
						{/if}
					</td>
				</tr>
			{/if}
		{/snippet}
	</CrudList>
</div>
