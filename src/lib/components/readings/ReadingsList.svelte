<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Parameter, type Reading, type Sensor, type Site, type StandardCurve } from '$api/crud';
	import CrudList, { type PageLoader } from '$components/crud/CrudList.svelte';
	import PointInspector from '$components/provenance/PointInspector.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { NO_VALUE, formatMeasurement } from '$lib/format';
	import { provenanceKindLabel } from '$lib/origin';
	import {
		PROVENANCE_KINDS,
		defaultFilter,
		readingsFilter,
		type ReadingsFilterState,
	} from '$lib/readings/listFilter';
	import { curveLabel, formatEquation } from '$lib/standardCurves';
	import { formatDateTime, fromDatetimeLocal, toDatetimeLocal } from '$lib/utils';

	let {
		sites,
		parameters,
		instruments,
		curves,
		load = (params) => api.readings.list(params),
		initial = defaultFilter(),
	}: {
		sites: Site[];
		parameters: Parameter[];
		instruments: Sensor[];
		curves: StandardCurve[];
			load?: PageLoader<Reading>;
		initial?: ReadingsFilterState;
	} = $props();

	// svelte-ignore state_referenced_locally
	let filter = $state<ReadingsFilterState>({ ...initial });
	let open = $state<string | null>(null);

	const rowKey = (r: Reading) => `${r.stream_id}|${r.time}|${r.replicate_index}`;
	const loadPage: PageLoader<Reading> = (params) =>
		load({ ...params, filter: { ...params.filter, ...readingsFilter(filter) } });

	const columns = [
		{ key: 'time', label: 'Time' },
		{ key: 'site_name', label: 'Site', sortable: false },
		{ key: 'parameter_code', label: 'Parameter', sortable: false },
		{ key: 'raw_value', label: 'Raw', class: 'text-right' },
		{ key: 'calibrated_value', label: 'Calibrated', sortable: false, class: 'text-right' },
		{ key: 'instrument_name', label: 'Instrument', sortable: false },
		{ key: 'calibration', label: 'Calibration', sortable: false },
		{ key: 'curve', label: 'Standard curve', sortable: false },
		{ key: 'ingested_at', label: 'Arrived' },
		{ key: 'provenance_kind', label: 'Origin', sortable: false },
	];

	function instrumentName(s: Sensor): string {
		return s.name ?? s.serial_number ?? s.id;
	}
</script>

<CrudList
	load={loadPage}
	{columns}
	title="Readings"
	showHeader={false}
	defaultSort={['time', 'DESC']}
	perPage={50}
	onrowclick={(r: Reading) => (open = open === rowKey(r) ? null : rowKey(r))}
	emptyText="No readings match"
>
	{#snippet filterBar({ reload })}
		<SiteSelect bind:value={filter.siteId} {sites} placeholder="All sites" onchange={reload} />
		<select
			bind:value={filter.parameterId}
			onchange={reload}
			aria-label="Parameter"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="">All parameters</option>
			{#each parameters as p (p.id)}<option value={p.id}>{p.code} ({p.default_units})</option>{/each}
		</select>
		<select
			bind:value={filter.instrumentId}
			onchange={reload}
			aria-label="Instrument"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="">All instruments</option>
			{#each instruments as s (s.id)}<option value={s.id}>{instrumentName(s)}</option>{/each}
		</select>
		<select
			bind:value={filter.curveId}
			onchange={reload}
			aria-label="Standard curve"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="">All standard curves</option>
			{#each curves as curve (curve.id)}<option value={curve.id}>{curveLabel(curve)}</option>{/each}
		</select>
		<label class="text-sm text-brand-muted flex items-center gap-1">
			From
			<input
				type="datetime-local"
				value={filter.from ? toDatetimeLocal(filter.from) : ''}
				onchange={(e) => { filter.from = e.currentTarget.value ? fromDatetimeLocal(e.currentTarget.value) : ''; reload(); }}
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text"
			/>
		</label>
		<label class="text-sm text-brand-muted flex items-center gap-1">
			To
			<input
				type="datetime-local"
				value={filter.to ? toDatetimeLocal(filter.to) : ''}
				onchange={(e) => { filter.to = e.currentTarget.value ? fromDatetimeLocal(e.currentTarget.value) : ''; reload(); }}
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text"
			/>
		</label>
		<select
			bind:value={filter.kind}
			onchange={reload}
			aria-label="Origin"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="">Any origin</option>
			{#each PROVENANCE_KINDS as [value, label] (value)}<option {value}>{label}</option>{/each}
		</select>
		<select
			bind:value={filter.flagged}
			onchange={reload}
			aria-label="Flagged"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="any">Flagged or not</option>
			<option value="flagged">Flagged only</option>
			<option value="clean">Unflagged only</option>
		</select>
		<label class="text-sm flex items-center gap-1">
			<input type="checkbox" bind:checked={filter.unverifiedOnly} onchange={reload} />
			Unverified only
		</label>
	{/snippet}

	{#snippet cell({ column, row, text })}
		{@const r = row as Reading}
		{#if column.key === 'time'}
			<span class="text-xs whitespace-nowrap">{formatDateTime(r.time)}</span>
			{#if r.replicate_index > 0}<span class="text-xs text-brand-muted ml-1">rep {r.replicate_index}</span>{/if}
		{:else if column.key === 'site_name'}
			{#if r.site_id}
				<a href="{base}/sites/{r.site_id}" onclick={(e) => e.stopPropagation()} class="text-brand-primary no-underline hover:underline">{r.site_name ?? r.site_id}</a>
			{:else}
				<Badge variant="muted">Unpaired</Badge>
			{/if}
		{:else if column.key === 'parameter_code'}
			<span class="font-mono text-xs">{r.parameter_code ?? NO_VALUE}</span>
			{#if r.units}<span class="text-xs text-brand-muted ml-1">{r.units}</span>{/if}
		{:else if column.key === 'raw_value'}
			<span class="tabular-nums {r.is_flagged || r.withdrawn_at ? 'line-through opacity-60' : ''}">{formatMeasurement(r.raw_value)}</span>
			{#if r.is_flagged}<Badge variant="warning">flagged</Badge>{/if}
			{#if r.withdrawn_at}<Badge variant="muted">withdrawn</Badge>{/if}
			{#if r.unverified}<Badge variant="accent">unverified</Badge>{/if}
		{:else if column.key === 'calibrated_value'}
			<span class="tabular-nums {r.calibrated_value == null ? 'text-brand-muted' : ''}">{formatMeasurement(r.calibrated_value)}</span>
		{:else if column.key === 'instrument_name'}
			{#if r.sensor_id}
				<a href="{base}/sensors/{r.sensor_id}" onclick={(e) => e.stopPropagation()} class="text-brand-primary no-underline hover:underline">{r.instrument_name ?? r.sensor_id}</a>
			{:else}
				<span class="text-brand-muted">{NO_VALUE}</span>
			{/if}
		{:else if column.key === 'calibration'}
			{#if r.calibration}
				<a href="{base}/sensors/{r.sensor_id}?tab=calibrations&cal={r.calibration.id}" onclick={(e) => e.stopPropagation()} class="text-brand-primary no-underline hover:underline text-xs" title="From {formatDateTime(r.calibration.valid_from)}{r.calibration.valid_until ? ` to ${formatDateTime(r.calibration.valid_until)}` : ''}">
					{r.calibration.name ?? formatEquation(r.calibration.slope, r.calibration.intercept)}
				</a>
			{:else}
				<span class="text-brand-muted text-xs">{NO_VALUE}</span>
			{/if}
		{:else if column.key === 'curve'}
			{#if r.curve}
				<a href="{base}/sensors/{r.sensor_id}?tab=curves&curve={r.curve.id}" onclick={(e) => e.stopPropagation()} class="text-brand-primary no-underline hover:underline text-xs" title={formatEquation(r.curve.slope, r.curve.intercept)}>{curveLabel(r.curve)}</a>
			{:else}
				<span class="text-brand-muted text-xs">{NO_VALUE}</span>
			{/if}
		{:else if column.key === 'ingested_at'}
			<span class="text-xs text-brand-muted whitespace-nowrap">{r.ingested_at ? formatDateTime(r.ingested_at) : NO_VALUE}</span>
		{:else if column.key === 'provenance_kind'}
			<span class="text-xs">{provenanceKindLabel(r.provenance_kind ?? undefined, { source: r.source_system ?? undefined }) ?? NO_VALUE}</span>
			{#if r.collection_event_id && r.site_id}
				<a href="{base}/sites/{r.site_id}?tab=visits&event={r.collection_event_id}" onclick={(e) => e.stopPropagation()} class="text-xs text-brand-primary no-underline hover:underline ml-1">visit</a>
			{/if}
		{:else}
			{text}
		{/if}
	{/snippet}

	{#snippet rowDetail({ row, colCount })}
		{@const r = row as Reading}
		{#if open === rowKey(r)}
			<tr class="border-b border-brand-divider">
				<td colspan={colCount} class="px-4 pb-3">
					{#if r.site_id && r.parameter_id}
						<PointInspector
							siteId={r.site_id}
							parameterId={r.parameter_id}
							parameterName={r.parameter_code ?? r.parameter_id}
							units={r.units}
							timeIso={r.time}
							measurementType={r.measurement_type ?? undefined}
							onclose={() => (open = null)}
						/>
					{:else}
						<p class="text-sm text-brand-muted">An unpaired reading has no record until its stream is paired.</p>
					{/if}
				</td>
			</tr>
		{/if}
	{/snippet}
</CrudList>
