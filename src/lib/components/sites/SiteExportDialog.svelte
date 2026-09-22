<script lang="ts">
	// The site's export dialog: readings in long format, plus the replicate, annotation and alarm
	// files the range can carry. The page owns the range the charts show and hands it over here.
	import { getSiteExportSummary, type ExportSummary } from '$api/service';
	import { downloadBlob } from '$lib/download';
	import type { SiteParameter } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { buildReadingsExportParams, exportColumns } from '$lib/sites/exportParams';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import TimestampInput from '$components/ui/TimestampInput.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';

	let {
		open = $bindable(false),
		siteId,
		siteName,
		siteParameters,
		rangeStartMs,
		rangeEndMs,
		sliderMinMs,
		sliderMaxMs,
		paramName,
		paramCode,
	}: {
		open?: boolean;
		siteId: string;
		siteName: string | null;
		siteParameters: SiteParameter[];
		/// The range the charts are showing, which is what an export opens on.
		rangeStartMs: number;
		rangeEndMs: number;
		/// The site's whole data period, which the slider still offers.
		sliderMinMs: number;
		sliderMaxMs: number;
		paramName: (paramId: string) => string;
		paramCode: (paramId: string) => string;
	} = $props();

	let exportStartMs = $state(Date.now() - 7 * 86400000);
	let exportEndMs = $state(Date.now());
	let exportFormat = $state<'csv' | 'json' | 'ndjson'>('csv');
	let exportResolution = $state<'raw' | 'hourly' | 'daily'>('hourly');
	let exportLoading = $state(false);
	let exportSelectedParamIds = $state<string[]>([]);
	let exportIncludeFlagged = $state(true);
	let exportIncludeReplicates = $state(false);
	let exportIncludeAnnotations = $state(false);
	let exportIncludeAlarms = $state(false);
	let exportSummary = $state<ExportSummary | null>(null);

	// What the export range can carry beyond the plain series, narrowed to the selected
	// parameters. Drives which options are enabled and the counts shown beside them.
	const exportCounts = $derived.by(() => {
		if (!exportSummary) return null;
		const rows =
			exportSelectedParamIds.length === 0
				? exportSummary.per_parameter
				: exportSummary.per_parameter.filter((p) => exportSelectedParamIds.includes(p.parameter_id));
		const sum = (f: (p: ExportSummary['per_parameter'][number]) => number) =>
			rows.reduce((s, p) => s + f(p), 0);
		return {
			annotation_count: sum((p) => p.annotation_count),
			annotated_points: sum((p) => p.annotated_points),
			flagged_readings: sum((p) => p.flagged_readings),
			replicate_readings: sum((p) => p.replicate_readings),
			alarm_readings: sum((p) => p.alarm_readings),
		};
	});

	$effect(() => {
		if (!open || !exportStartMs || !exportEndMs) return;
		const start = new Date(exportStartMs).toISOString();
		const end = new Date(exportEndMs).toISOString();
		const t = setTimeout(async () => {
			try {
				exportSummary = await getSiteExportSummary(siteId, start, end);
			} catch {
				exportSummary = null;
			}
		}, 400);
		return () => clearTimeout(t);
	});
	let exportMeasurementType = $state<'all' | 'continuous' | 'spot' | 'derived'>('all');

	const exportStartStr = $derived(exportStartMs ? new Date(exportStartMs).toISOString() : '');
	const exportEndStr = $derived(exportEndMs ? new Date(exportEndMs).toISOString() : '');

	function onExportStartInput(instant: string) {
		if (instant) exportStartMs = new Date(instant).getTime();
	}
	function onExportEndInput(instant: string) {
		if (instant) exportEndMs = new Date(instant).getTime();
	}
	// The dialog opens on the range the charts are showing, read once per opening so a range
	// typed here is not overwritten while it is open.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			exportStartMs = rangeStartMs;
			exportEndMs = rangeEndMs;
		}
		wasOpen = open;
	});

	// The header the file will carry, so the options are read as columns rather than as promises.
	const exportColumnNames = $derived.by(() => {
		const selected =
			exportSelectedParamIds.length > 0
				? exportSelectedParamIds
				: siteParameters.filter((sp) => sp.entry_mode !== 'tool').map((sp) => sp.parameter_id);
		const codes = selected.map((id) => paramCode(id)).filter((c) => c !== '');
		return exportColumns(codes, {
			startMs: exportStartMs,
			endMs: exportEndMs,
			parameterIds: exportSelectedParamIds,
			format: exportFormat,
			resolution: exportResolution,
			includeFlagged: exportIncludeFlagged,
			measurementType: exportMeasurementType,
		});
	});

	// An option whose range holds nothing is shown disabled, never silently exported.
	$effect(() => {
		if (!exportCounts) return;
		if (exportCounts.flagged_readings === 0) exportIncludeFlagged = false;
		if (exportCounts.replicate_readings === 0) exportIncludeReplicates = false;
		if (exportCounts.annotation_count === 0) exportIncludeAnnotations = false;
		if (exportCounts.alarm_readings === 0) exportIncludeAlarms = false;
	});

	// Export
	async function handleExport() {
		if (!exportStartMs || !exportEndMs) return;
		exportLoading = true;
		try {
			const { auth } = await import('$auth/keycloak.svelte');
			await auth.ensureToken();
			const download = async (url: string, filename: string) => {
				const response = await fetch(url, {
					headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
				});
				if (!response.ok) {
					const detail = await response.text().catch(() => response.statusText);
					throw new Error(`${response.status}: ${detail.slice(0, 200)}`);
				}
				downloadBlob(await response.blob(), filename);
			};
			const rangeParams = () => {
				const params = new URLSearchParams({
					start: new Date(exportStartMs).toISOString(),
					end: new Date(exportEndMs).toISOString(),
				});
				if (exportSelectedParamIds.length > 0) {
					params.set('parameter_ids', exportSelectedParamIds.join(','));
				}
				return params;
			};

			const params = buildReadingsExportParams({
				startMs: exportStartMs,
				endMs: exportEndMs,
				parameterIds: exportSelectedParamIds,
				format: exportFormat,
				resolution: exportResolution,
				includeFlagged: exportIncludeFlagged,
				measurementType: exportMeasurementType,
			});
			const path = exportResolution === 'raw'
				? `/api/sites/${siteId}/readings`
				: `/api/sites/${siteId}/aggregates/${exportResolution}`;
			const name = siteName ?? 'export';
			await download(
				`${path}?${params.toString()}`,
				`${name}_${exportResolution}.${exportFormat === 'ndjson' ? 'ndjson' : exportFormat}`
			);

			if (exportIncludeReplicates && (exportCounts?.replicate_readings ?? 0) > 0) {
				const repParams = rangeParams();
				repParams.set('format', 'csv');
				await download(
					`/api/sites/${siteId}/export/replicates?${repParams.toString()}`,
					`${name}_replicates.csv`
				);
			}
			if (exportIncludeAnnotations && (exportCounts?.annotation_count ?? 0) > 0) {
				const annParams = rangeParams();
				annParams.set('format', 'csv');
				await download(
					`/api/sites/${siteId}/annotations?${annParams.toString()}`,
					`${name}_annotations.csv`
				);
			}
			if (exportIncludeAlarms && (exportCounts?.alarm_readings ?? 0) > 0) {
				const alarmParams = rangeParams();
				alarmParams.set('format', 'csv');
				await download(
					`/api/sites/${siteId}/alarms?${alarmParams.toString()}`,
					`${name}_alarms.csv`
				);
			}
			toastStore.success('Export downloaded');
			open = false;
		} catch (e) { toastStore.error(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed'); }
		finally { exportLoading = false; }
	}
</script>

	<Dialog bind:open title="Export Data" maxWidth="sm">
		{#snippet children()}
			<div class="space-y-3">
				<p class="text-xs text-brand-muted">
					Readings in long format, one row per reading
					<span class="cursor-help" title="Every reading in the range as its own row, with replicates, flags and sample statistics. For the one-row-per-visit grid with a column per parameter, use Download grid CSV on the Visits tab.">(i)</span>
				</p>
				<div class="rounded-md border border-brand-divider bg-brand-bg px-3 py-3 overflow-hidden">
					<TimeRangeSlider
						min={sliderMinMs}
						max={sliderMaxMs}
						bind:start={exportStartMs}
						bind:end={exportEndMs}
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="exp-start" class="text-sm font-medium block mb-1">Start</label>
						<TimestampInput id="exp-start" value={exportStartStr} onchange={onExportStartInput} />
					</div>
					<div>
						<label for="exp-end" class="text-sm font-medium block mb-1">End</label>
						<TimestampInput id="exp-end" value={exportEndStr} onchange={onExportEndInput} />
					</div>
				</div>
				<div>
					<span id="exp-params-label" class="text-sm font-medium block mb-1">Parameters</span>
					<div role="group" aria-labelledby="exp-params-label" class="max-h-32 overflow-y-auto border border-brand-divider rounded-md p-2 space-y-1">
						<label class="flex items-center gap-2 cursor-pointer text-xs text-brand-muted">
							<input type="checkbox" checked={exportSelectedParamIds.length === 0} onchange={() => exportSelectedParamIds = []} /> All parameters
						</label>
						{#each siteParameters.filter((sp) => sp.entry_mode !== 'tool') as sp}
							<label class="flex items-center gap-2 cursor-pointer text-xs">
								<input type="checkbox" value={sp.parameter_id} bind:group={exportSelectedParamIds} /> {paramName(sp.parameter_id)}
							</label>
						{/each}
					</div>
				</div>
				<div>
					<label for="exp-res" class="text-sm font-medium block mb-1">Resolution</label>
					<select id="exp-res" bind:value={exportResolution} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="raw">Raw</option>
						<option value="hourly">Hourly</option>
						<option value="daily">Daily</option>
					</select>
				</div>
				{#if exportResolution === 'raw'}
					<div>
						<label for="exp-mt" class="text-sm font-medium block mb-1">Measurement type</label>
						<select id="exp-mt" bind:value={exportMeasurementType} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="all">All (sensor + grab samples)</option>
							<option value="continuous">Continuous (sensor only)</option>
							<option value="spot">Spot (grab samples only)</option>
							<option value="derived">Derived</option>
						</select>
					</div>
				{/if}
				<div class="flex flex-col gap-2">
					{#if exportResolution === 'raw'}
						<label class="flex items-start gap-2 text-sm {exportCounts?.flagged_readings === 0 ? 'opacity-50' : 'cursor-pointer'}">
							<input type="checkbox" class="mt-0.5" bind:checked={exportIncludeFlagged} disabled={exportCounts?.flagged_readings === 0} />
							<span>
								Include flagged readings (with flag metadata)
								{#if exportCounts}
									<span class="block text-xs text-brand-muted">{exportCounts.flagged_readings} flagged readings in this range</span>
								{/if}
							</span>
						</label>
					{/if}
					<label class="flex items-start gap-2 text-sm {exportCounts?.replicate_readings === 0 ? 'opacity-50' : 'cursor-pointer'}">
						<input type="checkbox" class="mt-0.5" bind:checked={exportIncludeReplicates} disabled={exportCounts?.replicate_readings === 0} />
						<span>
							Also download replicates CSV
							{#if exportCounts}
								<span class="block text-xs text-brand-muted">{exportCounts.replicate_readings} replicate readings in this range; rows join on sample_id, or on parameter code and timestamp</span>
							{/if}
						</span>
					</label>
					<label class="flex items-start gap-2 text-sm {exportCounts?.annotation_count === 0 ? 'opacity-50' : 'cursor-pointer'}">
						<input type="checkbox" class="mt-0.5" bind:checked={exportIncludeAnnotations} disabled={exportCounts?.annotation_count === 0} />
						<span>
							Also download annotations CSV
							{#if exportCounts}
								<span class="block text-xs text-brand-muted">{exportCounts.annotation_count} annotations covering {exportCounts.annotated_points} data points; rows join on parameter code and timestamp</span>
							{/if}
						</span>
					</label>
					<label class="flex items-start gap-2 text-sm {exportCounts?.alarm_readings === 0 ? 'opacity-50' : 'cursor-pointer'}">
						<input type="checkbox" class="mt-0.5" bind:checked={exportIncludeAlarms} disabled={exportCounts?.alarm_readings === 0} />
						<span>
							Also download alarms CSV
							{#if exportCounts}
								<span class="block text-xs text-brand-muted">{exportCounts.alarm_readings} readings in warning or alarm; rows join on parameter and timestamp</span>
							{/if}
						</span>
					</label>
				</div>
				<div>
					<span id="exp-format-label" class="text-sm font-medium block mb-1">Format</span>
					<div role="radiogroup" aria-labelledby="exp-format-label" class="flex gap-3">
						{#each [['csv', 'CSV'], ['json', 'JSON'], ['ndjson', 'NDJSON']] as [val, label]}
							<label class="flex items-center gap-1.5 cursor-pointer text-sm">
								<input type="radio" bind:group={exportFormat} value={val} /> {label}
							</label>
						{/each}
					</div>
				</div>
				{#if exportFormat !== 'json'}
					<div>
						<span class="text-sm font-medium block mb-1">Columns</span>
						<p class="text-xs text-brand-muted break-all">{exportColumnNames.join(', ')}</p>
						<p class="text-xs text-brand-muted mt-1">Value columns are the parameter code. A column is written only where the range holds the data it names.</p>
					</div>
				{/if}
			</div>
		{/snippet}
		{#snippet actions()}
			<Button onclick={() => open = false}>Cancel</Button>
			<Button variant="primary" onclick={handleExport} disabled={exportLoading}>{exportLoading ? 'Exporting…' : 'Download'}</Button>
		{/snippet}
	</Dialog>
