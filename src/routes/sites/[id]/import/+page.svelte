<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import Papa from 'papaparse';
	import { listAll } from '$api/paged';
	import { readVaisalaFile } from '$lib/upload/vaisalaHeader';
	import { api, type Site, type SiteParameter, type Parameter, type ReprocessingJob } from '$api/crud';
	import { POST } from '$api/client';
	import {
		jobWaitLabel,
		listTools,
		pollJob,
		type ToolDescriptor,
		type SeasonalClass,
		type SeasonalMethod,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import CurvePicker, {
		emptyCurveSelection,
		type CurveSelection,
	} from '$components/tools/CurvePicker.svelte';

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

	interface ImportCurve {
		slot: string;
		label: string;
		required: boolean;
		column: string | null;
		standard_curve_id: string | null;
		name: string | null;
	}

	interface ScreenedCell {
		row: number;
		parameter_id: string;
		value: number;
		class: SeasonalClass;
		warning: boolean;
		n: number;
		min: number | null;
		max: number | null;
	}

	// The seasonal Check gate's CSV arm: the plan carries the check the commit must name.
	interface ImportCheck {
		check_id: string | null;
		screened: number;
		warnings: number;
		findings: ScreenedCell[];
		method: SeasonalMethod;
	}

	const CLASS_LABELS: Record<string, string> = {
		no_history: 'no history',
		below_min: 'below recorded minimum',
		below_q10: 'below Q10',
		normal: 'normal',
		above_q90: 'above Q90',
		above_max: 'above recorded maximum',
	};

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
		replicate_groups: number;
		overlaps_identical: number;
		overlaps_differing: number;
		overlap_sample: OverlapDiff[];
		overwritten: number;
		errors: RowError[];
		error_count: number;
		tool_runs_created: number;
		curves: ImportCurve[];
		check: ImportCheck | null;
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
	let jobError = $state<string | null>(null);
	let conflictMode = $state<'skip' | 'overwrite'>('skip');
	// Cadence stamped on every imported reading: continuous sensor series or spot (grab/lab) results.
	let measurementType = $state<'continuous' | 'spot'>('continuous');
	// Whether the file holds raw instrument output (the covering calibration is stamped and
	// applied) or already-processed values (stored as served, no calibration claimed).
	let valueState = $state<'raw' | 'corrected'>('corrected');
	// Tool entry: the file's columns are the tool's inputs, one run per row, outputs saved with
	// the run's provenance. Empty imports the columns as catalog parameters.
	let tools = $state<ToolDescriptor[]>([]);
	let toolName = $state('');
	// The stored standard curve each of the tool's curve slots takes for every row.
	let curveSelections = $state<Record<string, CurveSelection>>({});

	let stagingSessionId = $state<string | null>(null);

	// Timezone: offset (hours) of source timestamps relative to UTC
	let tzOffsetHours = $state(0);
	let tzAutoDetected = $state(false);
	let tzAutoLabel = $state('');

	const dataColumns = $derived(previewHeaders.filter((h) => !isDateTimeColumn(h)));
	const paramNameById = $derived(new Map(siteParamOptions.map((o) => [o.id, o.label])));
	const selectedTool = $derived(tools.find((t) => t.name === toolName) ?? null);
	/** The `replicates` param a curve slot corrects, which names the parameter its curves are for. */
	function curveSlotParam(slot: string) {
		return selectedTool?.params.find((p) => p.kind === 'replicates' && p.curve === slot) ?? null;
	}
	// A manual slope/intercept has no stored row for the readings to reference, so the import
	// cannot record it.
	const manualCurveSlots = $derived(
		Object.entries(curveSelections)
			.filter(([, c]) => c.slope !== null && !c.standardCurveId)
			.map(([slot]) => slot),
	);
	const curveSlotById = $derived(new Map((plan?.curves ?? []).map((c) => [c.column, c.slot])));

	function requestCurves(): Record<string, string> | undefined {
		const m: Record<string, string> = {};
		for (const [slot, c] of Object.entries(curveSelections)) {
			if (c.standardCurveId) m[slot] = c.standardCurveId;
		}
		return Object.keys(m).length > 0 ? m : undefined;
	}

	function selectTool(name: string) {
		toolName = name;
		curveSelections = Object.fromEntries(
			(tools.find((t) => t.name === name)?.curves ?? []).map((c) => [c.name, emptyCurveSelection()]),
		);
		if (step === 'review') preview();
	}

	function isDateTimeColumn(h: string): boolean {
		const l = h.toLowerCase();
		return l === 'datetime' || l === 'time';
	}

	onMount(async () => {
		try {
			const [s, sp, params, t] = await Promise.all([
				api.sites.get(siteId),
				api.siteParameters.list({ perPage: 200, filter: { site_id: siteId } }),
				listAll(api.parameters),
				listTools().catch(() => [] as ToolDescriptor[]),
			]);
			site = s;
			tools = t;
			const unitsById = new Map(params.map((p: Parameter) => [p.id, p.default_units]));
			siteParamOptions = sp.data
				.filter((p: SiteParameter) => p.entry_mode !== 'tool')
				.map((p: SiteParameter) => {
					const units = unitsById.get(p.parameter_id) ?? '';
					const name = p.name ?? '';
					return {
						id: p.parameter_id,
						label: units ? `${name} (${units})` : name,
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
			const read = await readVaisalaFile(file);
			if (read.timezone) {
				tzAutoDetected = true;
				tzAutoLabel = read.timezone.label;
				tzOffsetHours = read.timezone.offsetHours;
			}

			csvText = read.text;
			const parsed = Papa.parse<Record<string, string>>(csvText, {
				header: true,
				skipEmptyLines: true,
				delimiter: read.tsv ? '\t' : undefined,
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
				dry_run: true,
				tz_offset_hours: tzOffsetHours || undefined,
				...(toolName
					? { tool: toolName, curves: requestCurves() }
					: { mapping: buildMapping(), measurement_type: measurementType }),
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
		jobError = null;
		try {
			const body: Record<string, unknown> = {
				site: siteId,
				conflict: conflictMode,
				tz_offset_hours: tzOffsetHours || undefined,
				...(toolName
					? { tool: toolName, curves: requestCurves() }
					: { mapping: buildMapping(), measurement_type: measurementType, values: valueState }),
				// The commit is held to the values the preview screened.
				...(plan?.check?.check_id ? { check_id: plan.check.check_id } : {}),
			};
			if (stagingSessionId) {
				body.session_id = stagingSessionId;
			} else {
				body.csv = csvText;
			}
			result = await POST<ImportPlan>('/api/readings/import_csv', body);
			step = 'done';
			toastStore.success('Import started');
			if (result.derived_job_id) followImport(result.derived_job_id);
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
	async function followImport(jobId: string) {
		try {
			await pollJob(jobId, { onTick: (j) => (job = j) });
		} catch (e) {
			jobError = e instanceof Error ? e.message : 'The import job did not complete';
		}
	}

	function applyLocalOverride(_col: string) {
		preview();
	}

	function resolvedLabel(col: string): string {
		if (!plan) return '';
		if (plan.mapped_columns[col]) return `→ ${plan.mapped_columns[col]}`;
		if (curveSlotById.has(col)) return `→ curve slot ${curveSlotById.get(col)}`;
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
		jobError = null;
		conflictMode = 'skip';
		measurementType = 'continuous';
		valueState = 'corrected';
		toolName = '';
		curveSelections = {};
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
				aligned to this site's parameters; derived parameters are recomputed, not imported. Or import
				it as tool entry: the columns are a tool's inputs, the tool runs on every row, and the results
				are saved with the run's provenance.
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
					{@render toolSelect('tool-select')}
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
				<Button
					variant="primary"
					class="mt-3"
					disabled={busy}
					onclick={preview}
				>
					{busy ? 'Analysing…' : 'Preview alignment'}
				</Button>
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

			<div class="mb-3">
				{@render toolSelect('tool-select-review')}
			</div>

			{#if selectedTool}
				<div class="mb-3 rounded-md border border-brand-primary/30 bg-brand-primary/5 px-3 py-2 text-sm">
					Rows run through <strong>{selectedTool.label}</strong>. Replicate columns are stored raw
					with the curve below and corrected by it; outputs are stored as the run computed them.
					Every reading records the run as a CSV import.
				</div>
				{#each plan.curves as slot (slot.slot)}
					<div class="mb-3 rounded-md border border-brand-divider px-3 py-2">
						<CurvePicker
							title={`${slot.label} (${slot.slot})`}
							required={slot.required}
							bind:value={curveSelections[slot.slot]}
							{siteId}
							parameterId={curveSlotParam(slot.slot)?.parameter?.id ?? null}
							parameterCode={curveSlotParam(slot.slot)?.parameter_code ?? null}
						/>
						{#if slot.column}
							<p class="mt-1 text-xs text-brand-muted">
								Column <code>{slot.column}</code> names a curve id per row; a blank cell takes the
								curve chosen here.
							</p>
						{/if}
					</div>
				{/each}
				{#if manualCurveSlots.length > 0}
					<p class="mb-3 rounded-md bg-severity-alarm-soft px-3 py-2 text-sm text-severity-alarm">
						{manualCurveSlots.join(', ')}: a slope and intercept typed here is not a stored curve, so the
						imported readings could not record it. Pick a stored curve or leave the slot empty.
					</p>
				{/if}
			{/if}

			<div class="mb-3 flex items-center gap-3" class:hidden={selectedTool !== null}>
				<span class="text-sm font-medium whitespace-nowrap">Measurement type</span>
				<label class="flex items-center gap-1.5 text-sm">
					<input type="radio" name="measurement-type" value="continuous" bind:group={measurementType} />
					Continuous
				</label>
				<label class="flex items-center gap-1.5 text-sm">
					<input type="radio" name="measurement-type" value="spot" bind:group={measurementType} />
					Grab sample
				</label>
			</div>

			<div class="mb-3" class:hidden={selectedTool !== null}>
				<div class="flex items-center gap-3">
					<span class="text-sm font-medium whitespace-nowrap">Values are</span>
					<label class="flex items-center gap-1.5 text-sm">
						<input type="radio" name="value-state" value="corrected" bind:group={valueState} />
						Processed (stored as-is, no calibration applied)
					</label>
					<label class="flex items-center gap-1.5 text-sm">
						<input type="radio" name="value-state" value="raw" bind:group={valueState} />
						Raw instrument output (apply the covering calibration)
					</label>
				</div>
				{#if valueState === 'corrected' && !selectedTool}
					<p class="mt-1 text-xs text-brand-muted">
						Processed values are recorded as a CSV import with no tool run: the provenance of each
						reading shows the import, not the calculation that produced the number. To carry the
						calculation, import the raw inputs as tool entry.
					</p>
				{/if}
			</div>

			<p class="mb-2 text-sm font-medium">Column alignment</p>
			<div class="overflow-x-auto rounded-md border border-brand-divider">
				<table class="w-full text-left text-sm">
					<thead class="bg-brand-bg">
						<tr>
							<th class="px-3 py-2 font-medium">CSV column</th>
							<th class="px-3 py-2 font-medium">Resolved</th>
							{#if !selectedTool}<th class="px-3 py-2 font-medium">Map to (override)</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each dataColumns as col}
							<tr class="border-t border-brand-divider">
								<td class="px-3 py-2 font-mono text-xs">{col}</td>
								<td class="px-3 py-2">
									{#if plan.mapped_columns[col] || curveSlotById.has(col)}
										<span class="text-severity-ok">{resolvedLabel(col)}</span>
									{:else if plan.skipped_columns.includes(col)}
										<span class="text-brand-muted">skipped</span>
									{:else}
										<span class="text-severity-alarm">unmapped</span>
									{/if}
								</td>
								{#if !selectedTool}
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
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if plan.replicate_groups > 0}
				<div class="mt-3 rounded-md bg-brand-primary/5 border border-brand-primary/30 px-3 py-2 text-sm">
					<strong>{plan.replicate_groups}</strong> timestamp{plan.replicate_groups === 1 ? ' has' : 's have'} multiple values and will be stored as replicate sets.
				</div>
			{/if}

			{#if plan.check}
				<div
					class="mt-3 rounded-md px-3 py-2 text-sm {plan.check.warnings > 0
						? 'bg-severity-warning-soft'
						: 'bg-severity-ok-soft text-severity-ok'}"
				>
					<div class="flex items-center gap-1">
						<p class="font-medium">
							Seasonal check: {plan.check.screened} value{plan.check.screened === 1 ? '' : 's'} screened,
							{plan.check.warnings} outside the site's seasonal range
						</p>
						<span class="group relative inline-block">
							<button
								type="button"
								class="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-normal"
								aria-label="How this check is computed"
							>
								i
							</button>
							<div
								class="absolute left-0 top-5 z-20 hidden w-80 rounded-md border border-brand-divider bg-brand-surface p-2.5 text-left text-xs font-normal text-brand-text shadow-lg group-hover:block group-focus-within:block"
								role="tooltip"
							>
								<p class="mb-1 font-semibold">How this check is computed</p>
								<p><span class="font-medium">Window.</span> {plan.check.method.window}</p>
								<p><span class="font-medium">Pooled.</span> {plan.check.method.pooled}</p>
								<p><span class="font-medium">Value.</span> {plan.check.method.value}</p>
								<p><span class="font-medium">Statistics.</span> {plan.check.method.statistics}</p>
								<ul class="mt-1 space-y-0.5">
									{#each plan.check.method.classes as c}
										<li>
											<span class="font-mono">{CLASS_LABELS[c.class] ?? c.class}</span>: {c.meaning}{c.warning ? ' (warning)' : ''}
										</li>
									{/each}
								</ul>
							</div>
						</span>
					</div>
					{#if plan.check.findings.length > 0}
						<ul class="list-disc pl-5">
							{#each plan.check.findings.slice(0, 20) as f}
								<li>
									Row {f.row}: {paramNameById.get(f.parameter_id) ?? f.parameter_id} = {f.value},
									{CLASS_LABELS[f.class] ?? f.class}{f.min !== null && f.max !== null
										? ` (seasonal range ${f.min.toPrecision(4)} to ${f.max.toPrecision(4)}, n=${f.n})`
										: ''}
								</li>
							{/each}
						</ul>
						{#if plan.check.findings.length < plan.check.warnings}
							<p class="text-xs text-brand-muted">…and {plan.check.warnings - plan.check.findings.length} more</p>
						{:else if plan.check.findings.length > 20}
							<p class="text-xs text-brand-muted">…and {plan.check.findings.length - 20} more</p>
						{/if}
						<p class="mt-1 text-xs">
							Advisory: importing keeps these values. The import is held to exactly the values shown
							in this preview; change the file or the mapping and preview again.
						</p>
					{/if}
				</div>
			{/if}

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
					{#if selectedTool}
						No columns match an input of {selectedTool.label} - head them with its input names.
					{:else}
						No columns resolve to a parameter - map at least one column before importing.
					{/if}
				</p>
			{/if}

			<div class="mt-4 flex gap-2">
				<Button onclick={reset}>Cancel</Button>
				<Button
					variant="primary"
					disabled={busy || Object.keys(plan.mapped_columns).length === 0 || manualCurveSlots.length > 0}
					onclick={runImport}
				>
					{busy ? 'Importing…' : `Import ${plan.row_count} rows`}
				</Button>
			</div>
		</div>
	{:else if step === 'done' && result}
		<div class="rounded-md border border-brand-divider bg-white p-4">
			{#if selectedTool}
				<div class="rounded-md bg-severity-ok-soft px-3 py-2 text-sm text-severity-ok">
					<strong>{result.tool_runs_created}</strong> {selectedTool.label} run{result.tool_runs_created === 1 ? '' : 's'},
					<strong>{result.inserted_total}</strong> reading{result.inserted_total === 1 ? '' : 's'} saved with their provenance.
				</div>
			{:else if result.derived_job_id}
				<div class="text-sm">
					{#if job && job.status === 'completed'}
						<div class="rounded-md bg-severity-ok-soft px-3 py-2 text-severity-ok">
							Import complete - <strong>{job.readings_updated ?? 0}</strong> reading{(job.readings_updated ?? 0) === 1 ? '' : 's'} written ({Object.keys(result.mapped_columns).length} parameters).
						</div>
					{:else if jobError}
						<div class="rounded-md bg-severity-alarm-soft px-3 py-2 text-severity-alarm">
							Import did not complete: {jobError}
						</div>
					{:else}
						<div class="rounded-md bg-brand-bg px-3 py-2">
							<span class="text-brand-muted">
								Importing readings{#if job}: {jobWaitLabel(job)}{/if}…
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
				<Button onclick={reset}>Import another</Button>
			</div>
		</div>
	{/if}
</div>

{#snippet toolSelect(id: string)}
	<div class="flex items-center gap-3">
		<label for={id} class="text-sm font-medium whitespace-nowrap">Import as</label>
		<select
			{id}
			value={toolName}
			onchange={(e) => selectTool((e.target as HTMLSelectElement).value)}
			class="rounded-md border border-brand-divider px-2 py-1 text-sm"
		>
			<option value="">Catalog parameters (one column per parameter)</option>
			{#each tools as t (t.name)}
				<option value={t.name}>Tool entry: {t.label}</option>
			{/each}
		</select>
	</div>
{/snippet}
