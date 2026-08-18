<script lang="ts">
	import { onMount } from 'svelte';
	import Papa from 'papaparse';
	import { api, type Site, type Parameter } from '$api/crud';
	import { POST } from '$api/client';
	import { grabConflictGroups, type GrabExistingGroup } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// --- Entity data ---
	let sites = $state<Site[]>([]);
	let params = $state<Parameter[]>([]);
	let loadingEntities = $state(true);

	// --- Step tracking ---
	type Step = 'file' | 'mapping' | 'preview' | 'upload';
	let step = $state<Step>('file');

	// --- Step 1: File + entity type ---
	type EntityType = 'readings' | 'grab_samples' | 'status_events';
	let entityType = $state<EntityType>('readings');
	let fileName = $state('');
	let csvHeaders = $state<string[]>([]);
	let csvData = $state<Record<string, string>[]>([]);
	let parseError = $state('');

	// --- Step 2: Column mapping ---
	type MappingMode = 'single' | 'column';
	let mappingMode = $state<MappingMode>('single');

	// Single mode: user picks one site + one parameter for all rows
	let singleSiteId = $state('');
	let singleParameterId = $state('');

	// Column-mapped mode: which CSV column holds site name / parameter name
	let siteColumn = $state('');
	let paramColumn = $state('');

	// Common: which CSV column is the timestamp, value, calibrated value
	let timeColumn = $state('');
	let valueColumn = $state('');
	let calibratedColumn = $state('');

	// Timezone: offset (hours) of source timestamps relative to UTC
	let tzOffsetHours = $state(0);

	function downloadTemplate() {
		const example = sites[0]?.name ?? 'Site name';
		const exampleParam = params[0]?.name ?? 'Parameter name';
		const lines: Record<EntityType, string[]> = {
			readings: [
				'time,site,parameter,value,calibrated_value',
				`2026-01-15 10:30:00,${example},${exampleParam},12.4,`,
			],
			grab_samples: [
				'time,site,parameter,value',
				`2026-01-15 10:30:00,${example},${exampleParam},12.4`,
				`2026-01-15 10:30:00,${example},${exampleParam},12.6`,
			],
			status_events: [
				'time,site,parameter,value',
				`2026-01-15 10:30:00,${example},${exampleParam},OK`,
			],
		};
		const blob = new Blob([lines[entityType].join('\n') + '\n'], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `river-data-${entityType}-template.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// Parse a CSV timestamp deterministically: strings carrying an explicit zone are absolute;
	// naive strings are interpreted in the selected zone (never the uploader's browser zone).
	function parseRowTime(s: string): Date {
		const trimmed = s.trim();
		if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) return new Date(trimmed);
		const utc = new Date(trimmed.replace(' ', 'T') + 'Z');
		return new Date(utc.getTime() - tzOffsetHours * 3_600_000);
	}
	let tzAutoDetected = $state(false);
	let tzAutoLabel = $state('');

	// --- Step 3: Validation ---
	interface ValidationError {
		row: number;
		message: string;
	}
	let validationErrors = $state<ValidationError[]>([]);

	// --- Step 4: Upload ---
	let uploading = $state(false);
	let uploadProgress = $state(0);
	let uploadResult = $state<{ inserted: number; total: number; duplicates: number } | null>(null);
	let uploadError = $state<{ message: string; insertedBefore: number } | null>(null);
	// Replicate groups already stored at the uploaded timestamps; confirming re-runs with replace.
	let grabConflict = $state<GrabExistingGroup[] | null>(null);

	// --- Derived ---
	const siteMap = $derived(new Map(sites.map((s) => [s.name.toLowerCase(), s])));
	const paramMap = $derived(new Map(params.map((p) => [p.name.toLowerCase(), p])));

	const previewRows = $derived(csvData.slice(0, 10));

	const isReadyForMapping = $derived(
		csvHeaders.length > 0 && csvData.length > 0 && !parseError,
	);

	const requiredColumnsSet = $derived(() => {
		if (mappingMode === 'single') {
			return timeColumn !== '' && valueColumn !== '' && singleSiteId !== '' && singleParameterId !== '';
		}
		return timeColumn !== '' && valueColumn !== '' && siteColumn !== '' && paramColumn !== '';
	});

	const canUpload = $derived(validationErrors.length === 0 && csvData.length > 0);

	// --- Load sites + parameters ---
	onMount(async () => {
		try {
			const [s, p] = await Promise.all([
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 500 }),
			]);
			sites = s.data;
			params = p.data;
		} catch (e) {
			toastStore.error('Failed to load sites/parameters');
		} finally {
			loadingEntities = false;
		}
	});

	// --- Timezone auto-detection from file header ---
	function detectTimezoneFromHeader(file: File): Promise<void> {
		return new Promise((resolve) => {
			tzAutoDetected = false;
			tzAutoLabel = '';
			tzOffsetHours = 0;

			const reader = new FileReader();
			reader.onload = () => {
				const text = reader.result as string;
				const firstLine = text.split(/\r?\n/)[0];
				const match = firstLine.match(/Time zone:.*\(UTC([+-]\d{2}):(\d{2})\)/i);
				if (match) {
					const hours = parseInt(match[1], 10);
					const minutes = parseInt(match[2], 10);
					tzOffsetHours = hours + (hours < 0 ? -1 : 1) * (minutes / 60);
					tzAutoDetected = true;
					const sign = tzOffsetHours >= 0 ? '+' : '';
					tzAutoLabel = firstLine.match(/\(([^)]+)\)/)?.[1] ?? `UTC${sign}${tzOffsetHours}`;
				}
				resolve();
			};
			reader.onerror = () => resolve();
			reader.readAsText(file.slice(0, 512), 'utf-16le');
		});
	}

	// --- CSV parsing ---
	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		fileName = file.name;
		parseError = '';
		csvHeaders = [];
		csvData = [];

		if (file.name.endsWith('.tsv')) {
			await detectTimezoneFromHeader(file);
		}

		Papa.parse<Record<string, string>>(file, {
			header: true,
			skipEmptyLines: true,
			delimiter: file.name.endsWith('.tsv') ? '\t' : undefined,
			complete(results) {
				if (results.errors.length > 0) {
					parseError = results.errors.map((e) => e.message).join('; ');
					return;
				}
				if (!results.meta.fields || results.meta.fields.length === 0) {
					parseError = 'No column headers detected';
					return;
				}
				csvHeaders = results.meta.fields;
				csvData = results.data;

				// Auto-detect common column names
				const lower = csvHeaders.map((h) => h.toLowerCase());
				const timeGuesses = ['time', 'timestamp', 'datetime', 'date_time', 'date'];
				const valueGuesses = ['raw_value', 'value', 'reading', 'measurement'];
				const calGuesses = ['calibrated_value', 'cal_value', 'corrected_value'];
				const siteGuesses = ['site', 'site_name', 'location'];
				const paramGuesses = ['parameter', 'parameter_name', 'param', 'variable'];

				for (const g of timeGuesses) {
					const idx = lower.indexOf(g);
					if (idx >= 0) { timeColumn = csvHeaders[idx]; break; }
				}
				for (const g of valueGuesses) {
					const idx = lower.indexOf(g);
					if (idx >= 0) { valueColumn = csvHeaders[idx]; break; }
				}
				for (const g of calGuesses) {
					const idx = lower.indexOf(g);
					if (idx >= 0) { calibratedColumn = csvHeaders[idx]; break; }
				}
				for (const g of siteGuesses) {
					const idx = lower.indexOf(g);
					if (idx >= 0) { siteColumn = csvHeaders[idx]; mappingMode = 'column'; break; }
				}
				for (const g of paramGuesses) {
					const idx = lower.indexOf(g);
					if (idx >= 0) { paramColumn = csvHeaders[idx]; mappingMode = 'column'; break; }
				}
			},
			error(err) {
				parseError = err.message;
			},
		});
	}

	// --- Validation ---
	// Checks that need only the file: a cell the API could not parse at all. The admissible
	// timestamp window belongs to the API, which reports the offending row itself, so it is not
	// restated here where it would drift out of date.
	function validate(): ValidationError[] {
		const errors: ValidationError[] = [];

		for (let i = 0; i < csvData.length; i++) {
			const row = csvData[i];
			const rowNum = i + 2; // 1-indexed + header

			// Time
			const timeStr = row[timeColumn];
			if (!timeStr) {
				errors.push({ row: rowNum, message: 'Missing timestamp' });
				continue;
			}
			const ts = parseRowTime(timeStr).getTime();
			if (isNaN(ts)) {
				errors.push({ row: rowNum, message: `Invalid timestamp: "${timeStr}"` });
				continue;
			}
			// Value
			const valStr = row[valueColumn];
			if (valStr === undefined || valStr === '') {
				errors.push({ row: rowNum, message: 'Missing value' });
				continue;
			}
			const val = Number(valStr);
			if (isNaN(val)) {
				errors.push({ row: rowNum, message: `Non-numeric value: "${valStr}"` });
				continue;
			}

			// Column-mapped: resolve site + parameter names
			if (mappingMode === 'column') {
				const siteName = row[siteColumn];
				if (!siteName) {
					errors.push({ row: rowNum, message: 'Missing site name' });
					continue;
				}
				if (!siteMap.get(siteName.toLowerCase())) {
					errors.push({ row: rowNum, message: `Unknown site: "${siteName}"` });
					continue;
				}
				const paramName = row[paramColumn];
				if (!paramName) {
					errors.push({ row: rowNum, message: 'Missing parameter name' });
					continue;
				}
				if (!paramMap.get(paramName.toLowerCase())) {
					errors.push({ row: rowNum, message: `Unknown parameter: "${paramName}"` });
					continue;
				}
			}
		}

		return errors;
	}

	function runValidation() {
		validationErrors = validate();
		uploadError = null;
		step = 'preview';
	}

	// --- Build payload rows ---
	function buildPayload(): Array<Record<string, unknown>> {
		return csvData.map((row) => {
			let siteId: string;
			let parameterId: string;

			if (mappingMode === 'single') {
				siteId = singleSiteId;
				parameterId = singleParameterId;
			} else {
				const site = siteMap.get(row[siteColumn].toLowerCase());
				const param = paramMap.get(row[paramColumn].toLowerCase());
				siteId = site!.id;
				parameterId = param!.id;
			}

			const time = parseRowTime(row[timeColumn]).toISOString();
			const rawValue = Number(row[valueColumn]);

			if (entityType === 'readings') {
				const entry: Record<string, unknown> = {
					site_id: siteId,
					parameter_id: parameterId,
					time,
					raw_value: rawValue,
				};
				if (calibratedColumn && row[calibratedColumn]) {
					entry.calibrated_value = Number(row[calibratedColumn]);
				}
				return entry;
			} else if (entityType === 'grab_samples') {
				return {
					site_id: siteId,
					parameter_id: parameterId,
					value: rawValue,
					time,
				};
			} else {
				// status_events
				return {
					site_id: siteId,
					parameter_id: parameterId,
					time,
					value: String(row[valueColumn]),
				};
			}
		});
	}

	// --- Upload ---
	const CHUNK_SIZE = 1000;

	interface UploadRequest {
		endpoint: string;
		body: unknown;
		rows: number;
	}

	// Grab samples go to a per-site endpoint, and a replicate group (same parameter and time) must
	// land in one request so the API can form its sample and number the replicates consistently.
	function buildGrabSampleRequests(
		allRows: Array<Record<string, unknown>>,
		replace: boolean,
	): UploadRequest[] {
		const bySite = new Map<string, Map<string, Array<Record<string, unknown>>>>();
		for (const row of allRows) {
			const { site_id, ...reading } = row;
			const groups = bySite.get(site_id as string) ?? new Map<string, Array<Record<string, unknown>>>();
			const key = `${reading.parameter_id}|${reading.time}`;
			const group = groups.get(key) ?? [];
			group.push(reading);
			groups.set(key, group);
			bySite.set(site_id as string, groups);
		}

		const requests: UploadRequest[] = [];
		for (const [siteId, groups] of bySite) {
			let chunk: Array<Record<string, unknown>> = [];
			const flush = () => {
				if (chunk.length === 0) return;
				requests.push({
					endpoint: '/api/grab_samples',
					body: { site_id: siteId, readings: chunk, ...(replace ? { mode: 'replace' } : {}) },
					rows: chunk.length,
				});
				chunk = [];
			};
			for (const group of groups.values()) {
				if (chunk.length > 0 && chunk.length + group.length > CHUNK_SIZE) flush();
				chunk.push(...group);
			}
			flush();
		}
		return requests;
	}

	function buildBatchRequests(allRows: Array<Record<string, unknown>>): UploadRequest[] {
		const endpoint = entityType === 'readings' ? '/api/readings/batch' : '/api/status_events/batch';
		const key = entityType === 'readings' ? 'readings' : 'events';
		const requests: UploadRequest[] = [];
		for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
			const chunk = allRows.slice(i, i + CHUNK_SIZE);
			requests.push({ endpoint, body: { [key]: chunk }, rows: chunk.length });
		}
		return requests;
	}

	function buildRequests(allRows: Array<Record<string, unknown>>, replace: boolean): UploadRequest[] {
		return entityType === 'grab_samples' ? buildGrabSampleRequests(allRows, replace) : buildBatchRequests(allRows);
	}

	// The API reports a rejected write as {"error": "…"}; the client surfaces the raw body, so
	// unwrap it here rather than showing the user a JSON document.
	function serverMessage(e: unknown): string {
		const raw = e instanceof Error ? e.message : String(e);
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed.error === 'string') return parsed.error;
		} catch {
			// Not a JSON body (network failure, proxy error): the raw text is the message.
		}
		return raw || 'Upload failed';
	}

	async function handleUpload(replace = false) {
		uploading = true;
		uploadProgress = 0;
		uploadResult = null;
		uploadError = null;
		grabConflict = null;

		const allRows = buildPayload();
		const requests = buildRequests(allRows, replace);
		let totalInserted = 0;

		try {
			for (let i = 0; i < requests.length; i++) {
				const req = requests[i];
				const result = await POST<{ inserted: number; samples_created?: number }>(req.endpoint, req.body);
				totalInserted += result.inserted;
				uploadProgress = Math.round(((i + 1) / requests.length) * 100);
			}

			const duplicates = allRows.length - totalInserted;
			uploadResult = { inserted: totalInserted, total: allRows.length, duplicates };
			toastStore.success(`Uploaded ${totalInserted} records`);
			step = 'upload';
		} catch (e) {
			const groups = grabConflictGroups(e);
			if (groups) {
				grabConflict = groups;
			} else {
				// The batch endpoints reject a chunk whole, so the message names the offending
				// timestamp or value. Keep it on the page: a toast is gone before the user has
				// found the row it refers to.
				uploadError = { message: serverMessage(e), insertedBefore: totalInserted };
				toastStore.error('Upload failed');
			}
		} finally {
			uploading = false;
		}
	}

	// --- Compute derived ---
	async function computeDerived() {
		try {
			await POST('/api/actions/compute_derived', {});
			toastStore.success('Derived parameters computation triggered');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to trigger derived computation');
		}
	}

	// --- Navigation helpers ---
	function goToStep(target: Step) {
		step = target;
	}

	function reset() {
		step = 'file';
		fileName = '';
		csvHeaders = [];
		csvData = [];
		parseError = '';
		timeColumn = '';
		valueColumn = '';
		calibratedColumn = '';
		siteColumn = '';
		paramColumn = '';
		singleSiteId = '';
		singleParameterId = '';
		mappingMode = 'single';
		tzOffsetHours = 0;
		tzAutoDetected = false;
		tzAutoLabel = '';
		validationErrors = [];
		uploadProgress = 0;
		uploadResult = null;
		uploadError = null;
		grabConflict = null;
	}

	function resolvedSiteName(row: Record<string, string>): string {
		if (mappingMode === 'single') {
			return sites.find((s) => s.id === singleSiteId)?.name ?? 'None';
		}
		return row[siteColumn] ?? 'None';
	}

	function resolvedParamName(row: Record<string, string>): string {
		if (mappingMode === 'single') {
			const p = params.find((p) => p.id === singleParameterId);
			return p ? (p.default_units ? `${p.name} (${p.default_units})` : p.name) : 'None';
		}
		return row[paramColumn] ?? 'None';
	}
</script>

<svelte:head><title>Upload Data | River Data</title></svelte:head>

<div class="space-y-6 max-w-4xl">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Bulk Data Upload</h2>
		{#if step !== 'file'}
			<Button variant="ghost" size="sm" onclick={reset}>
				Start Over
			</Button>
		{/if}
	</div>

	{#if step === 'file'}
		<p class="text-sm text-brand-muted">
			For a wide CSV export with one column per parameter (logger downloads, site
			exports), use the site importer instead: open the site and choose Import. It
			previews column mapping and detects overlaps with existing data before writing.
			This page suits long-format files (one value per row) across sites and parameters.
		</p>
		<Button variant="secondary" size="sm" onclick={downloadTemplate}>
			Download CSV template
		</Button>
	{/if}

	<!-- Step indicator -->
	<div class="flex items-center gap-2 text-sm">
		{#each [
			{ key: 'file', label: '1. File' },
			{ key: 'mapping', label: '2. Mapping' },
			{ key: 'preview', label: '3. Preview' },
			{ key: 'upload', label: '4. Upload' },
		] as s}
			<span class={step === s.key ? 'text-brand-primary font-semibold' : 'text-brand-muted'}>
				{s.label}
			</span>
			{#if s.key !== 'upload'}
				<span class="text-brand-muted">&#8250;</span>
			{/if}
		{/each}
	</div>

	{#if loadingEntities}
		<p class="text-brand-muted">Loading sites and parameters…</p>
	{:else}

		<!-- ============ STEP 1: FILE SELECTION ============ -->
		{#if step === 'file'}
			<div class="space-y-4">
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label for="entityType" class="text-sm font-medium block mb-1">Data Type</label>
						<select id="entityType" bind:value={entityType} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="readings">Readings</option>
							<option value="grab_samples">Grab Samples</option>
							<option value="status_events">Status Events</option>
						</select>
					</div>
					<div>
						<label for="csvFile" class="text-sm font-medium block mb-1">CSV File</label>
						<input id="csvFile" type="file" accept=".csv,.tsv" onchange={handleFileSelect} class="w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:border-0 file:rounded-md file:bg-brand-primary file:text-white file:text-sm file:cursor-pointer" />
					</div>
				</div>

				{#if parseError}
					<div class="rounded-md border border-severity-alarm-border bg-severity-alarm-soft px-4 py-3 text-sm text-severity-alarm">
						Parse error: {parseError}
					</div>
				{/if}

				{#if csvHeaders.length > 0}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-2">
						<p class="text-sm"><span class="font-medium">{fileName}</span> &mdash; {csvData.length.toLocaleString()} rows, {csvHeaders.length} columns</p>
						<div class="flex flex-wrap gap-1.5">
							{#each csvHeaders as h}
								<span class="px-2 py-0.5 rounded bg-brand-bg text-xs text-brand-muted border border-brand-divider">{h}</span>
							{/each}
						</div>
					</div>

					<Button
						variant="primary"
						onclick={() => goToStep('mapping')}
						disabled={!isReadyForMapping}
					>
						Next: Column Mapping
					</Button>
				{/if}
			</div>

		<!-- ============ STEP 2: COLUMN MAPPING ============ -->
		{:else if step === 'mapping'}
			<div class="space-y-4">
				<!-- Mapping mode -->
				<div>
					<!-- svelte-ignore a11y_label_has_associated_control -->
				<label class="text-sm font-medium block mb-2">Site/Parameter Mode</label>
					<div class="flex gap-4">
						<label class="flex items-center gap-2 text-sm cursor-pointer">
							<input type="radio" bind:group={mappingMode} value="single" class="accent-[var(--brand-primary)]" />
							Single site + parameter (all rows)
						</label>
						<label class="flex items-center gap-2 text-sm cursor-pointer">
							<input type="radio" bind:group={mappingMode} value="column" class="accent-[var(--brand-primary)]" />
							Column-mapped (site/parameter per row)
						</label>
					</div>
				</div>

				{#if mappingMode === 'single'}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label for="singleSite" class="text-sm font-medium block mb-1">Site <span class="text-severity-alarm">*</span></label>
							<select id="singleSite" bind:value={singleSiteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
								<option value="">-- Select site --</option>
								{#each sites as s}
									<option value={s.id}>{s.name}</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="singleParam" class="text-sm font-medium block mb-1">Parameter <span class="text-severity-alarm">*</span></label>
							<select id="singleParam" bind:value={singleParameterId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
								<option value="">-- Select parameter --</option>
								{#each params as p}
									<option value={p.id}>{p.name} ({p.default_units})</option>
								{/each}
							</select>
						</div>
					</div>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<label for="siteCol" class="text-sm font-medium block mb-1">Site Name Column <span class="text-severity-alarm">*</span></label>
							<select id="siteCol" bind:value={siteColumn} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
								<option value="">-- Select column --</option>
								{#each csvHeaders as h}
									<option value={h}>{h}</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="paramCol" class="text-sm font-medium block mb-1">Parameter Name Column <span class="text-severity-alarm">*</span></label>
							<select id="paramCol" bind:value={paramColumn} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
								<option value="">-- Select column --</option>
								{#each csvHeaders as h}
									<option value={h}>{h}</option>
								{/each}
							</select>
						</div>
					</div>
				{/if}

				<!-- Time + value columns -->
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
					<div>
						<label for="timeCol" class="text-sm font-medium block mb-1">Time Column <span class="text-severity-alarm">*</span></label>
						<select id="timeCol" bind:value={timeColumn} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="">-- Select column --</option>
							{#each csvHeaders as h}
								<option value={h}>{h}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="valCol" class="text-sm font-medium block mb-1">Value Column <span class="text-severity-alarm">*</span></label>
						<select id="valCol" bind:value={valueColumn} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="">-- Select column --</option>
							{#each csvHeaders as h}
								<option value={h}>{h}</option>
							{/each}
						</select>
					</div>
					{#if entityType === 'readings'}
						<div>
							<label for="calCol" class="text-sm font-medium block mb-1">Calibrated Value Column</label>
							<select id="calCol" bind:value={calibratedColumn} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
								<option value="">-- None --</option>
								{#each csvHeaders as h}
									<option value={h}>{h}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>

				<!-- Timezone offset -->
				<div class="space-y-2">
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
						<div>
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<label class="text-sm font-medium block mb-1">Timestamp Timezone</label>
							<select
								value={tzOffsetHours}
								onchange={(e) => { tzOffsetHours = Number((e.target as HTMLSelectElement).value); }}
								class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
							>
								<option value={0}>UTC +00:00</option>
								<option value={1}>CET +01:00</option>
								<option value={2}>CEST +02:00</option>
								<option value={-1}>UTC -01:00</option>
								<option value={3}>UTC +03:00</option>
								<option value={5.5}>IST +05:30</option>
							</select>
						</div>
					</div>
					{#if tzAutoDetected}
						<div class="rounded-md border border-brand-primary/30 bg-brand-primary/5 px-3 py-2 text-sm">
							Detected from file header: <span class="font-medium">{tzAutoLabel}</span>
						</div>
					{/if}
					{#if tzOffsetHours !== 0}
						<p class="text-xs text-brand-muted">
							Timestamps will be shifted by {tzOffsetHours > 0 ? '-' : '+'}{Math.abs(tzOffsetHours)}h to convert to UTC for storage.
						</p>
					{/if}
				</div>

				<div class="flex gap-3">
					<Button onclick={() => goToStep('file')}>
						Back
					</Button>
					<Button
						variant="primary"
						onclick={runValidation}
						disabled={!requiredColumnsSet()}
					>
						Next: Preview
					</Button>
				</div>
			</div>

		<!-- ============ STEP 3: PREVIEW + VALIDATION ============ -->
		{:else if step === 'preview'}
			<div class="space-y-4">
				<!-- Validation summary -->
				{#if validationErrors.length > 0}
					<div class="rounded-md border border-severity-alarm-border bg-severity-alarm-soft px-4 py-3 space-y-1">
						<p class="text-sm font-medium text-severity-alarm">{validationErrors.length.toLocaleString()} validation error{validationErrors.length === 1 ? '' : 's'}</p>
						{#each validationErrors.slice(0, 3) as err}
							<p class="text-sm text-severity-alarm">Row {err.row}: {err.message}</p>
						{/each}
						{#if validationErrors.length > 3}
							<p class="text-xs text-severity-alarm">... and {validationErrors.length - 3} more</p>
						{/if}
					</div>
				{:else}
					<div class="rounded-md border border-severity-ok-border bg-severity-ok-soft px-4 py-3">
						<p class="text-sm text-severity-ok">All {csvData.length.toLocaleString()} rows passed validation</p>
					</div>
				{/if}

				<!-- Preview table -->
				<div class="rounded-md border border-brand-divider overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-brand-bg border-b border-brand-divider">
								<th class="px-3 py-2 text-left font-medium text-brand-muted">#</th>
								<th class="px-3 py-2 text-left font-medium text-brand-muted">Site</th>
								<th class="px-3 py-2 text-left font-medium text-brand-muted">Parameter</th>
								<th class="px-3 py-2 text-left font-medium text-brand-muted">{tzOffsetHours !== 0 ? 'Original Time' : 'Time'}</th>
								{#if tzOffsetHours !== 0}
									<th class="px-3 py-2 text-left font-medium text-brand-muted">Stored (UTC)</th>
								{/if}
								<th class="px-3 py-2 text-left font-medium text-brand-muted">Value</th>
								{#if entityType === 'readings' && calibratedColumn}
									<th class="px-3 py-2 text-left font-medium text-brand-muted">Calibrated</th>
								{/if}
							</tr>
						</thead>
						<tbody>
							{#each previewRows as row, i}
								<tr class="border-b border-brand-divider hover:bg-brand-bg/50">
									<td class="px-3 py-1.5 text-brand-muted">{i + 1}</td>
									<td class="px-3 py-1.5">{resolvedSiteName(row)}</td>
									<td class="px-3 py-1.5">{resolvedParamName(row)}</td>
									<td class="px-3 py-1.5 font-mono text-xs">{row[timeColumn] ?? 'None'}</td>
									{#if tzOffsetHours !== 0}
										<td class="px-3 py-1.5 font-mono text-xs text-brand-primary">{row[timeColumn] ? parseRowTime(row[timeColumn]).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'None'}</td>
									{/if}
									<td class="px-3 py-1.5 font-mono">{row[valueColumn] ?? 'None'}</td>
									{#if entityType === 'readings' && calibratedColumn}
										<td class="px-3 py-1.5 font-mono">{row[calibratedColumn] ?? 'None'}</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if csvData.length > 10}
					<p class="text-xs text-brand-muted">Showing first 10 of {csvData.length.toLocaleString()} rows</p>
				{/if}

				<div class="flex gap-3">
					<Button onclick={() => goToStep('mapping')}>
						Back
					</Button>
					<Button
						variant="primary"
						onclick={() => handleUpload()}
						disabled={!canUpload || uploading}
					>
						{#if uploading}
							Uploading… {uploadProgress}%
						{:else}
							Upload {csvData.length.toLocaleString()} Rows
						{/if}
					</Button>
				</div>

				{#if uploading}
					<div class="w-full bg-brand-bg rounded-full h-2 overflow-hidden">
						<div class="bg-brand-primary h-full rounded-full transition-[width] duration-300" style:width="{uploadProgress}%"></div>
					</div>
				{/if}

				{#if grabConflict}
					<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-4 py-3 space-y-2 text-sm">
						<p class="font-medium text-severity-warning-text">
							{grabConflict.length} replicate group{grabConflict.length === 1 ? '' : 's'} already stored
							at the uploaded timestamps. Nothing was replaced.
						</p>
						{#each grabConflict.slice(0, 10) as g}
							<div class="text-xs">
								<span class="font-medium">{params.find((p) => p.id === g.parameter_id)?.name ?? g.parameter_id.slice(0, 8)}</span>
								<span class="text-brand-muted">at {g.time}:</span>
								<span class="font-mono">{g.replicates.map((r) => r.calibrated_value ?? r.raw_value).join(', ')}</span>
							</div>
						{/each}
						{#if grabConflict.length > 10}
							<p class="text-xs text-brand-muted">…and {grabConflict.length - 10} more</p>
						{/if}
						<Button variant="danger" size="sm" disabled={uploading} onclick={() => handleUpload(true)}>
							Replace existing replicates
						</Button>
					</div>
				{/if}

				{#if uploadError}
					<ErrorNotice>
						<p class="font-medium">Upload rejected</p>
						<p>{uploadError.message}</p>
						{#if uploadError.insertedBefore > 0}
							<p class="mt-1">
								{uploadError.insertedBefore.toLocaleString()} record{uploadError.insertedBefore === 1 ? '' : 's'}
								were inserted before the rejection. Correct the file and upload again; rows already
								stored are skipped as duplicates.
							</p>
						{/if}
					</ErrorNotice>
				{/if}
			</div>

		<!-- ============ STEP 4: RESULTS ============ -->
		{:else if step === 'upload' && uploadResult}
			<div class="space-y-4">
				<div class="rounded-md border border-severity-ok-border bg-severity-ok-soft px-4 py-4 space-y-1">
					<p class="text-sm font-medium text-severity-ok">Upload Complete</p>
					<p class="text-sm">Inserted <span class="font-semibold">{uploadResult.inserted.toLocaleString()}</span> records.</p>
					{#if uploadResult.duplicates > 0}
						<p class="text-sm text-brand-muted">{uploadResult.duplicates.toLocaleString()} duplicate{uploadResult.duplicates === 1 ? '' : 's'} skipped.</p>
					{/if}
				</div>

				<div class="flex gap-3">
					<Button variant="primary" onclick={reset}>
						Upload Another File
					</Button>
					<Button onclick={computeDerived}>
						Compute Derived Parameters
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
