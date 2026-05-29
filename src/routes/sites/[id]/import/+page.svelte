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

	interface ImportPlan {
		site_id: string;
		site_name: string;
		dry_run: boolean;
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

	const dataColumns = $derived(previewHeaders.filter((h) => !isDateTimeColumn(h)));

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
			const nameById = new Map(params.data.map((p: Parameter) => [p.id, p.display_name || p.name]));
			siteParamOptions = sp.data
				.filter((p: SiteParameter) => !p.is_derived)
				.map((p: SiteParameter) => ({
					id: p.parameter_id,
					label: nameById.get(p.parameter_id) ?? p.name ?? p.parameter_id,
				}));
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
		try {
			csvText = await file.text();
			const parsed = Papa.parse<Record<string, string>>(csvText, {
				header: true,
				skipEmptyLines: true,
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
			plan = await POST<ImportPlan>('/api/readings/import_csv', {
				site: siteId,
				csv: csvText,
				mapping: buildMapping(),
				dry_run: true,
			});
			step = 'review';
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Preview failed');
		} finally {
			busy = false;
		}
	}

	async function runImport() {
		busy = true;
		job = null;
		try {
			result = await POST<ImportPlan>('/api/readings/import_csv', {
				site: siteId,
				csv: csvText,
				mapping: buildMapping(),
			});
			step = 'done';
			toastStore.success(
				`Imported ${result.inserted_total} new reading${result.inserted_total === 1 ? '' : 's'}` +
					(result.duplicates > 0 ? ` (${result.duplicates} duplicates skipped)` : ''),
			);
			if (result.derived_job_id) pollJob(result.derived_job_id);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Import failed');
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

	// Re-run the preview when the operator changes a column override.
	function onOverrideChange() {
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
	}
</script>

<div class="mx-auto max-w-4xl p-page-gutter">
	<div class="mb-4 flex items-center justify-between">
		<div>
			<a href="{base}/sites/{siteId}" class="text-sm text-brand-muted hover:underline">← Back to site</a>
			<h1 class="text-xl font-semibold">Import CSV{site ? ` — ${site.name}` : ''}</h1>
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
			<label class="block text-sm font-medium" for="csv-file">CSV file</label>
			<input
				id="csv-file"
				type="file"
				accept=".csv,text/csv"
				onchange={handleFile}
				class="mt-1 block w-full text-sm"
			/>
			{#if parseError}
				<p class="mt-2 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm text-severity-alarm">{parseError}</p>
			{/if}

			{#if previewHeaders.length > 0 && !parseError}
				<p class="mt-3 text-sm text-brand-muted">{fileName} — {previewHeaders.length} columns</p>
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
				<div><span class="block text-xs text-brand-muted">Earliest</span><span>{plan.earliest ?? '—'}</span></div>
				<div><span class="block text-xs text-brand-muted">Latest</span><span>{plan.latest ?? '—'}</span></div>
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
										onchange={onOverrideChange}
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
					<p class="font-medium">{plan.error_count} row problem{plan.error_count === 1 ? '' : 's'} — these rows are skipped on import:</p>
					<ul class="list-disc pl-5">{#each plan.errors.slice(0, 10) as e}<li>Row {e.row}: {e.message}</li>{/each}</ul>
					{#if plan.errors.length < plan.error_count}
						<p class="text-xs text-brand-muted">…and {plan.error_count - plan.errors.length} more</p>
					{/if}
				</div>
			{/if}

			{#if Object.keys(plan.mapped_columns).length === 0}
				<p class="mt-3 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm text-severity-alarm">
					No columns resolve to a parameter — map at least one column before importing.
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
			{#if result.inserted_total > 0}
				<div class="rounded-md bg-severity-ok-soft px-3 py-2 text-sm text-severity-ok">
					Imported <strong>{result.inserted_total}</strong> new reading{result.inserted_total === 1 ? '' : 's'}
					({Object.keys(result.mapped_columns).length} parameters){#if result.duplicates > 0}, skipped <strong>{result.duplicates}</strong> duplicate{result.duplicates === 1 ? '' : 's'}{/if}.
				</div>
			{:else}
				<div class="rounded-md bg-severity-warning-soft px-3 py-2 text-sm">
					No new readings — all <strong>{result.duplicates}</strong> already present (idempotent).
				</div>
			{/if}

			{#if result.derived_job_id}
				<div class="mt-3 text-sm">
					{#if job && job.status === 'completed'}
						<span class="text-severity-ok">✓ Derived parameters recomputed &amp; aggregates refreshed.</span>
					{:else if job && job.status === 'failed'}
						<span class="text-severity-alarm">Derived recompute failed — see the Jobs page.</span>
					{:else}
						<span class="text-brand-muted">
							Recomputing derived parameters &amp; refreshing aggregates{#if job?.total}: {job.progress ?? 0}/{job.total}{/if}…
						</span>
					{/if}
				</div>
			{/if}

			{#if result.error_count > 0}
				<div class="mt-3 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm">
					<p class="font-medium">{result.error_count} row{result.error_count === 1 ? '' : 's'} skipped — fix in the source and re-import:</p>
					<ul class="list-disc pl-5">{#each result.errors as e}<li>Row {e.row}: {e.message}</li>{/each}</ul>
					{#if result.errors.length < result.error_count}
						<p class="text-xs text-brand-muted">…and {result.error_count - result.errors.length} more</p>
					{/if}
				</div>
			{/if}

			<div class="mt-3 grid grid-cols-3 gap-4 text-sm">
				<div><span class="block text-xs text-brand-muted">Rows</span><span class="text-lg font-semibold">{result.row_count}</span></div>
				<div><span class="block text-xs text-brand-muted">Earliest</span><span>{result.earliest ?? '—'}</span></div>
				<div><span class="block text-xs text-brand-muted">Latest</span><span>{result.latest ?? '—'}</span></div>
			</div>
			<div class="mt-4 flex gap-2">
				<a href="{base}/sites/{siteId}" class="rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white">View site</a>
				<button class="rounded-md border border-brand-divider px-4 py-2 text-sm" onclick={reset}>Import another</button>
			</div>
		</div>
	{/if}
</div>
