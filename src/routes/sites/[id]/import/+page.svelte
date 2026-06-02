<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import Papa from 'papaparse';
	import { api, type Site, type SiteParameter, type Parameter, type ReprocessingJob } from '$api/crud';
	import { GET, POST } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface RowError {
		row: number;
		message: string;
	}

	interface OverlapDiff {
		time: string;
		parameter_id: string;
		existing: number;
		incoming: number;
	}

	interface ImportPlan {
		site_id: string;
		site_name: string;
		dry_run: boolean;
		session_id: string | null;
		mapped_columns: Record<string, string>;
		skipped_columns: string[];
		unmapped_columns: string[];
		warnings: string[];
		row_count: number;
		inserted_total: number;
		earliest: string | null;
		latest: string | null;
		derived_job_id: string | null;
		derived_timestamps: number;
		duplicates: number;
		overlaps_identical: number;
		overlaps_differing: number;
		overlap_sample: OverlapDiff[];
		overwritten: number;
		errors: RowError[];
		error_count: number;
	}

	const siteId = $derived(page.params.id!);

	let site = $state<Site | null>(null);
	// Parameters assigned to this site, with display labels, for the mapping dropdowns.
	let siteParamOptions = $state<{ id: string; label: string }[]>([]);
	let loading = $state(true);

	type Step = 'select' | 'review' | 'done';
	let step = $state<Step>('select');

	let fileName = $state('');
	let csvText = $state('');
	let previewHeaders = $state<string[]>([]);
	let previewRows = $state<Record<string, string>[]>([]);
	let parseError = $state('');

	// Per-column override: parameter id, or '' for skip, or absent for auto-resolution.
	let overrides = $state<Record<string, string>>({});
	let plan = $state<ImportPlan | null>(null);
	let busy = $state(false);
	let result = $state<ImportPlan | null>(null);
	let job = $state<ReprocessingJob | null>(null);
	let conflictMode = $state<'skip' | 'overwrite'>('skip');

	let stagingSessionId = $state<string | null>(null);

	// Timezone: offset (hours) of source timestamps relative to UTC
	let tzOffsetHours = $state(0);
	let tzAutoDetected = $state(false);
	let tzAutoLabel = $state('');

	const dataColumns = $derived(previewHeaders.filter((h) => !isDateTimeColumn(h)));
	const paramNameById = $derived(new Map(siteParamOptions.map((o) => [o.id, o.label])));

	function isDateTimeColumn(h: string): boolean {
		const l = h.toLowerCase();
		return l === 'datetime' || l === 'time';
	}

	onMount(async () => {
		try {
			const [s, sp, params] = await Promise.all([
				api.sites.get(siteId),
				api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } }),
				api.parameters.list({ perPage: 500 }),
			]);
			site = s;
			const unitsById = new Map(params.data.map((p: Parameter) => [p.id, p.default_units]));
			siteParamOptions = sp.data
				.filter((p: SiteParameter) => !p.is_derived)
				.map((p: SiteParameter) => {
					const units = unitsById.get(p.parameter_id) ?? '';
					return {
						id: p.parameter_id,
						label: units ? `${p.name} (${units})` : p.name,
					};
				});
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load site');
		} finally {
			loading = false;
		}
	});

	async function handleFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileName = file.name;
		parseError = '';
		overrides = {};
		plan = null;
		tzAutoDetected = false;
		tzAutoLabel = '';
		tzOffsetHours = 0;
		try {
			const rawBytes = await file.arrayBuffer();
			let text: string;

			// Vaisala TSV exports are UTF-16 LE with a timezone header line.
			const u16 = new Uint8Array(rawBytes);
			if (u16.length >= 2 && u16[0] === 0xff && u16[1] === 0xfe) {
				text = new TextDecoder('utf-16le').decode(rawBytes);
			} else {
				text = new TextDecoder('utf-8').decode(rawBytes);
			}

			// Auto-detect timezone from Vaisala TSV header
			const firstLine = text.split(/\r?\n/)[0];
			const tzMatch = firstLine.match(/Time zone:.*\(UTC([+-]\d{2}):(\d{2})\)/i);
			if (tzMatch) {
				const hours = parseInt(tzMatch[1], 10);
				const minutes = parseInt(tzMatch[2], 10);
				tzOffsetHours = hours + (hours < 0 ? -1 : 1) * (minutes / 60);
				tzAutoDetected = true;
				tzAutoLabel = firstLine.match(/\(([^)]+)\)/)?.[1] ?? `UTC${tzOffsetHours >= 0 ? '+' : ''}${tzOffsetHours}`;
				// Strip the timezone metadata line before parsing
				text = text.split(/\r?\n/).slice(1).join('\n');
			}

			csvText = text;
			const isTsv = file.name.endsWith('.tsv') || tzAutoDetected;
			const parsed = Papa.parse<Record<string, string>>(csvText, {
				header: true,
				skipEmptyLines: true,
				delimiter: isTsv ? '\t' : undefined,
				preview: 6,
			});
			if (parsed.errors.length > 0) {
				parseError = parsed.errors.map((e) => e.message).join('; ');
				return;
			}
			previewHeaders = parsed.meta.fields ?? [];
			previewRows = parsed.data.slice(0, 5);
			if (previewHeaders.length === 0) parseError = 'No column headers detected';
		} catch (e) {
			parseError = e instanceof Error ? e.message : 'Failed to read file';
		}
	}

	// Build the mapping object the API expects: column -> parameter id, or null to skip.
	function buildMapping(): Record<string, string | null> | undefined {
		const m: Record<string, string | null> = {};
		for (const [col, val] of Object.entries(overrides)) {
			if (val === '') m[col] = null; // explicit skip
			else if (val) m[col] = val; // parameter id
		}
		return Object.keys(m).length > 0 ? m : undefined;
	}

	async function preview() {
		busy = true;
		try {
			const body: Record<string, unknown> = {
				site: siteId,
				mapping: buildMapping(),
				dry_run: true,
				tz_offset_hours: tzOffsetHours || undefined,
			};
			if (stagingSessionId) {
				body.session_id = stagingSessionId;
			} else {
				body.csv = csvText;
			}
			plan = await POST<ImportPlan>('/api/readings/import_csv', body);
			stagingSessionId = plan.session_id;

			step = 'review';
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Preview failed';
			if (stagingSessionId && msg.includes('expired')) {
				stagingSessionId = null;
				return preview();
			}
			toastStore.error(msg);
		} finally {
			busy = false;
		}
	}

	async function runImport() {
		busy = true;
		job = null;
		try {
			const body: Record<string, unknown> = {
				site: siteId,
				mapping: buildMapping(),
				conflict: conflictMode,
				tz_offset_hours: tzOffsetHours || undefined,
			};
			if (stagingSessionId) {
				body.session_id = stagingSessionId;
			} else {
				body.csv = csvText;
			}
			result = await POST<ImportPlan>('/api/readings/import_csv', body);
			step = 'done';
			toastStore.success('Import started');
			if (result.derived_job_id) pollJob(result.derived_job_id);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Import failed';
			if (stagingSessionId && msg.includes('expired')) {
				stagingSessionId = null;
				return runImport();
			}
			toastStore.error(msg);
		} finally {
			busy = false;
		}
	}

	// Derived recompute + aggregate refresh run as a background job; poll it for progress.
	async function pollJob(jobId: string) {
		for (let i = 0; i < 180; i++) {
			try {
				job = await GET<ReprocessingJob>(`/api/reprocessing_jobs/${jobId}`);
			} catch {
				break;
			}
			if (job?.status === 'completed' || job?.status === 'failed') break;
			await new Promise((r) => setTimeout(r, 1000));
		}
	}

	function applyLocalOverride(_col: string) {
		preview();
	}

	function resolvedLabel(col: string): string {
		if (!plan) return '';
		if (plan.mapped_columns[col]) return `→ ${plan.mapped_columns[col]}`;
		if (plan.skipped_columns.includes(col)) return 'skipped';
		if (plan.unmapped_columns.includes(col)) return 'unmapped';
		return '';
	}

	function reset() {
		step = 'select';
		fileName = '';
		csvText = '';
		previewHeaders = [];
		previewRows = [];
		overrides = {};
		plan = null;
		result = null;
		job = null;
		conflictMode = 'skip';
		stagingSessionId = null;
		tzOffsetHours = 0;
		tzAutoDetected = false;
		tzAutoLabel = '';
	}
</script>

<div class="mx-auto max-w-4xl p-page-gutter">
	<div class="mb-4 flex items-center justify-between">
		<div>
			<a href="{base}/sites/{siteId}" class="text-sm text-brand-muted hover:underline">← Back to site</a>
			<h1 class="text-xl font-semibold">Import CSV{site ? ` - ${site.name}` : ''}</h1>
			<p class="text-sm text-brand-muted">
				Upload a wide CSV (a <code>DateTime</code> column plus one column per parameter). Columns are
				aligned to this site's parameters; derived parameters are recomputed, not imported.
			</p>
		</div>
	</div>

	{#if loading}
		<p class="text-brand-muted">Loading…</p>
	{:else if step === 'select'}
		<div class="rounded-md border border-brand-divider bg-white p-4">
			<label class="block text-sm font-medium" for="csv-file">CSV / TSV file</label>
			<input
				id="csv-file"
				type="file"
				accept=".csv,.tsv,text/csv,text/tab-separated-values"
				onchange={handleFile}
				class="mt-1 block w-full text-sm"
			/>
			{#if parseError}
				<p class="mt-2 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm text-severity-alarm">{parseError}</p>
			{/if}

			{#if previewHeaders.length > 0 && !parseError}
				<!-- Timezone selector -->
				<div class="mt-3 space-y-2">
					<div class="flex items-center gap-3">
						<label for="tz-offset" class="text-sm font-medium whitespace-nowrap">Timestamp timezone</label>
						<select
							id="tz-offset"
							value={tzOffsetHours}
							onchange={(e) => { tzOffsetHours = Number((e.target as HTMLSelectElement).value); }}
							class="rounded-md border border-brand-divider px-2 py-1 text-sm"
						>
							<option value={0}>UTC +00:00</option>
							<option value={1}>CET +01:00</option>
							<option value={2}>CEST +02:00</option>
							<option value={-1}>UTC -01:00</option>
							<option value={3}>UTC +03:00</option>
						</select>
						{#if tzOffsetHours !== 0}
							<span class="text-xs text-brand-muted">Timestamps will be shifted by {tzOffsetHours > 0 ? '-' : '+'}{Math.abs(tzOffsetHours)}h to UTC</span>
						{/if}
					</div>
					{#if tzAutoDetected}
						<div class="rounded-md border border-brand-primary/30 bg-brand-primary/5 px-3 py-2 text-sm">
							Detected from file header: <span class="font-medium">{tzAutoLabel}</span>
						</div>
					{/if}
				</div>

				<p class="mt-3 text-sm text-brand-muted">{fileName} - {previewHeaders.length} columns</p>
				<div class="mt-2 overflow-x-auto rounded-md border border-brand-divider">
					<table class="w-full text-left text-xs">
						<thead class="bg-brand-bg">
							<tr>{#each previewHeaders as h}<th class="px-2 py-1 font-medium">{h}</th>{/each}</tr>
						</thead>
						<tbody>
							{#each previewRows as row}
								<tr class="border-t border-brand-divider">
									{#each previewHeaders as h}<td class="px-2 py-1">{row[h]}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<button
					class="mt-3 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					disabled={busy}
					onclick={preview}
				>
					{busy ? 'Analysing…' : 'Preview alignment'}
				</button>
			{/if}
		</div>
	{:else if step === 'review' && plan}
		<div class="rounded-md border border-brand-divider bg-white p-4">
			<div class="mb-3 grid grid-cols-3 gap-4 text-sm">
				<div><span class="block text-xs text-brand-muted">Rows</span><span class="text-lg font-semibold">{plan.row_count}</span></div>
				<div><span class="block text-xs text-brand-muted">Earliest</span><span>{plan.earliest ?? '-'}</span></div>
				<div><span class="block text-xs text-brand-muted">Latest</span><span>{plan.latest ?? '-'}</span></div>
			</div>

			<div class="mb-3 flex items-center gap-3">
				<label for="tz-offset-review" class="text-sm font-medium whitespace-nowrap">Timestamp timezone</label>
				<select
					id="tz-offset-review"
					value={tzOffsetHours}
					onchange={(e) => { tzOffsetHours = Number((e.target as HTMLSelectElement).value); preview(); }}
					class="rounded-md border border-brand-divider px-2 py-1 text-sm"
				>
					<option value={0}>UTC +00:00</option>
					<option value={1}>CET +01:00</option>
					<option value={2}>CEST +02:00</option>
					<option value={-1}>UTC -01:00</option>
					<option value={3}>UTC +03:00</option>
				</select>
				{#if tzOffsetHours !== 0}
					<span class="text-xs text-brand-muted">Timestamps shifted by {tzOffsetHours > 0 ? '-' : '+'}{Math.abs(tzOffsetHours)}h to UTC</span>
				{/if}
				{#if tzAutoDetected}
					<span class="text-xs text-brand-muted">(detected: {tzAutoLabel})</span>
				{/if}
			</div>

			<p class="mb-2 text-sm font-medium">Column alignment</p>
			<div class="overflow-x-auto rounded-md border border-brand-divider">
				<table class="w-full text-left text-sm">
					<thead class="bg-brand-bg">
						<tr>
							<th class="px-3 py-2 font-medium">CSV column</th>
							<th class="px-3 py-2 font-medium">Resolved</th>
							<th class="px-3 py-2 font-medium">Map to (override)</th>
						</tr>
					</thead>
					<tbody>
						{#each dataColumns as col}
							<tr class="border-t border-brand-divider">
								<td class="px-3 py-2 font-mono text-xs">{col}</td>
								<td class="px-3 py-2">
									{#if plan.mapped_columns[col]}
										<span class="text-severity-ok">{resolvedLabel(col)}</span>
									{:else if plan.skipped_columns.includes(col)}
										<span class="text-brand-muted">skipped</span>
									{:else}
										<span class="text-severity-alarm">unmapped</span>
									{/if}
								</td>
								<td class="px-3 py-2">
									<select
										bind:value={overrides[col]}
										onchange={() => applyLocalOverride(col)}
										class="rounded-md border border-brand-divider px-2 py-1 text-sm"
									>
										<option value={undefined}>(auto)</option>
										<option value="">Skip</option>
										{#each siteParamOptions as opt}
											<option value={opt.id}>{opt.label}</option>
										{/each}
									</select>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if plan.warnings.length > 0}
				<div class="mt-3 rounded-md bg-severity-warning-soft px-3 py-2 text-sm">
					<p class="font-medium">Warnings</p>
					<ul class="list-disc pl-5">{#each plan.warnings as w}<li>{w}</li>{/each}</ul>
				</div>
			{/if}

			{#if plan.errors.length > 0}
				<div class="mt-3 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm">
					<p class="font-medium">{plan.error_count} row problem{plan.error_count === 1 ? '' : 's'} - these rows are skipped on import:</p>
					<ul class="list-disc pl-5">{#each plan.errors.slice(0, 10) as e}<li>Row {e.row}: {e.message}</li>{/each}</ul>
					{#if plan.errors.length < plan.error_count}
						<p class="text-xs text-brand-muted">…and {plan.error_count - plan.errors.length} more</p>
					{/if}
				</div>
			{/if}

			{#if plan.overlaps_identical > 0 || plan.overlaps_differing > 0}
				<div class="mt-3 space-y-2">
					{#if plan.overlaps_identical > 0}
						<div class="rounded-md bg-severity-ok-soft px-3 py-2 text-sm text-severity-ok">
							<strong>{plan.overlaps_identical}</strong> reading{plan.overlaps_identical === 1 ? '' : 's'} already in DB with identical values - will be skipped.
						</div>
					{/if}

					{#if plan.overlaps_differing > 0}
						<div class="rounded-md bg-severity-warning-soft px-3 py-2 text-sm">
							<p><strong>{plan.overlaps_differing}</strong> reading{plan.overlaps_differing === 1 ? '' : 's'} differ from stored values.</p>
							<fieldset class="mt-2 flex gap-4">
								<label class="flex items-center gap-1.5 text-sm">
									<input type="radio" name="conflict" value="skip" bind:group={conflictMode} />
									Skip (keep stored values)
								</label>
								<label class="flex items-center gap-1.5 text-sm">
									<input type="radio" name="conflict" value="overwrite" bind:group={conflictMode} />
									Overwrite with imported values
								</label>
							</fieldset>

							{#if plan.overlap_sample.length > 0}
								<details class="mt-2">
									<summary class="cursor-pointer text-xs font-medium text-brand-muted">
										Show {plan.overlap_sample.length} sample diff{plan.overlap_sample.length === 1 ? '' : 's'}
									</summary>
									<div class="mt-1 overflow-x-auto rounded-md border border-brand-divider">
										<table class="w-full text-left text-xs">
											<thead class="bg-brand-bg">
												<tr>
													<th class="px-2 py-1 font-medium">Time</th>
													<th class="px-2 py-1 font-medium">Parameter</th>
													<th class="px-2 py-1 font-medium text-right">Stored</th>
													<th class="px-2 py-1 font-medium text-right">Incoming</th>
												</tr>
											</thead>
											<tbody>
												{#each plan.overlap_sample as diff}
													<tr class="border-t border-brand-divider">
														<td class="px-2 py-1 font-mono">{diff.time}</td>
														<td class="px-2 py-1">{paramNameById.get(diff.parameter_id) ?? diff.parameter_id.slice(0, 8)}</td>
														<td class="px-2 py-1 text-right">{diff.existing}</td>
														<td class="px-2 py-1 text-right">{diff.incoming}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</details>
							{/if}
						</div>
					{/if}
				</div>
			{:else if plan.row_count > 0}
				<p class="mt-3 text-sm text-brand-muted">No overlap with existing data - all readings are new.</p>
			{/if}

			{#if Object.keys(plan.mapped_columns).length === 0}
				<p class="mt-3 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm text-severity-alarm">
					No columns resolve to a parameter - map at least one column before importing.
				</p>
			{/if}

			<div class="mt-4 flex gap-2">
				<button class="rounded-md border border-brand-divider px-4 py-2 text-sm" onclick={reset}>Cancel</button>
				<button
					class="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					disabled={busy || Object.keys(plan.mapped_columns).length === 0}
					onclick={runImport}
				>
					{busy ? 'Importing…' : `Import ${plan.row_count} rows`}
				</button>
			</div>
		</div>
	{:else if step === 'done' && result}
		<div class="rounded-md border border-brand-divider bg-white p-4">
			{#if result.derived_job_id}
				<div class="text-sm">
					{#if job && job.status === 'completed'}
						<div class="rounded-md bg-severity-ok-soft px-3 py-2 text-severity-ok">
							Import complete - <strong>{job.readings_updated ?? 0}</strong> reading{(job.readings_updated ?? 0) === 1 ? '' : 's'} written ({Object.keys(result.mapped_columns).length} parameters).
						</div>
					{:else if job && job.status === 'failed'}
						<div class="rounded-md bg-severity-alarm-soft px-3 py-2 text-severity-alarm">
							Import failed{#if job.error_message}: {job.error_message}{/if}
						</div>
					{:else}
						<div class="rounded-md bg-brand-bg px-3 py-2">
							<span class="text-brand-muted">
								Importing readings{#if job?.total}: {job?.progress ?? 0}/{job.total}{/if}…
							</span>
							<p class="text-xs text-brand-muted mt-1">This runs in the background - you can navigate away safely.</p>
						</div>
					{/if}
				</div>
			{:else}
				<div class="rounded-md bg-severity-warning-soft px-3 py-2 text-sm">
					No new readings - {#if result.overlaps_identical > 0}<strong>{result.overlaps_identical}</strong> identical{/if}{#if result.overlaps_identical > 0 && result.overlaps_differing > 0} + {/if}{#if result.overlaps_differing > 0}<strong>{result.overlaps_differing}</strong> differing{/if} already present.
				</div>
			{/if}

			{#if result.overlaps_identical > 0 || result.overlaps_differing > 0}
				<div class="mt-2 text-sm text-brand-muted">
					{#if result.overlaps_identical > 0}{result.overlaps_identical} identical skipped{/if}{#if result.overlaps_identical > 0 && result.overlaps_differing > 0}, {/if}{#if result.overlaps_differing > 0}{result.overlaps_differing} differing {conflictMode === 'overwrite' ? 'overwritten' : 'skipped'}{/if}
				</div>
			{/if}

			{#if result.error_count > 0}
				<div class="mt-3 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm">
					<p class="font-medium">{result.error_count} row{result.error_count === 1 ? '' : 's'} skipped - fix in the source and re-import:</p>
					<ul class="list-disc pl-5">{#each result.errors as e}<li>Row {e.row}: {e.message}</li>{/each}</ul>
					{#if result.errors.length < result.error_count}
						<p class="text-xs text-brand-muted">…and {result.error_count - result.errors.length} more</p>
					{/if}
				</div>
			{/if}

			<div class="mt-3 grid grid-cols-3 gap-4 text-sm">
				<div><span class="block text-xs text-brand-muted">Rows</span><span class="text-lg font-semibold">{result.row_count}</span></div>
				<div><span class="block text-xs text-brand-muted">Earliest</span><span>{result.earliest ?? '-'}</span></div>
				<div><span class="block text-xs text-brand-muted">Latest</span><span>{result.latest ?? '-'}</span></div>
			</div>
			<div class="mt-4 flex gap-2">
				<a href="{base}/sites/{siteId}" class="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white">View site</a>
				<button class="rounded-md border border-brand-divider px-4 py-2 text-sm" onclick={reset}>Import another</button>
			</div>
		</div>
	{/if}
</div>
