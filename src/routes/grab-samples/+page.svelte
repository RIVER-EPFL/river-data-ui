<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Project, type Site, type SiteParameter, type Parameter, type StandardCurve } from '$api/crud';
	import { POST } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';

	let projects = $state<Project[]>([]);
	let sites = $state<Site[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let params = $state<Parameter[]>([]);
	let standardCurves = $state<StandardCurve[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	interface SampleRow {
		paramId: string;
		replicates: string[];
		useStandardCurve: boolean;
		curveId: string;
		overrideValue: string;
	}

	let selectedProjectId = $state('');
	let selectedSiteId = $state('');
	let sampleDate = $state(new Date().toISOString().slice(0, 16));
	let rows = $state<SampleRow[]>([]);
	let submitting = $state(false);

	const filteredSites = $derived(selectedProjectId ? sites.filter((s) => s.project_id === selectedProjectId) : sites);
	const filteredParams = $derived(selectedSiteId ? siteParams.filter((sp) => sp.site_id === selectedSiteId) : []);

	function paramName(paramId: string): string {
		return params.find((p) => p.id === paramId)?.display_name ?? paramId;
	}

	function paramUnits(sp: SiteParameter): string {
		const param = params.find((p) => p.id === sp.parameter_id);
		return sp.display_units ?? param?.default_units ?? '';
	}

	function curvesForParam(paramId: string): StandardCurve[] {
		return standardCurves
			.filter((c) => c.parameter_id === paramId)
			.sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime());
	}

	function activeCurveForParam(paramId: string): StandardCurve | undefined {
		const sampleTime = new Date(sampleDate).getTime();
		return curvesForParam(paramId).find((c) => new Date(c.valid_from).getTime() <= sampleTime);
	}

	function replicateStats(row: SampleRow): { values: number[]; mean: number; sd: number; n: number } | null {
		const values: number[] = [];
		for (const rep of row.replicates) {
			if (rep === '' || rep === null || rep === undefined) continue;
			const v = Number(rep);
			if (!Number.isFinite(v)) continue;
			values.push(v);
		}
		if (values.length === 0) return null;
		const n = values.length;
		const mean = values.reduce((a, b) => a + b, 0) / n;
		const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
		return { values, mean, sd, n };
	}

	function isRowEmpty(row: SampleRow): boolean {
		return !row.paramId
			&& row.replicates.every((r) => r === '' || r === null || r === undefined)
			&& !row.overrideValue;
	}

	function correctedValue(row: SampleRow): number | null {
		const stats = replicateStats(row);
		if (!stats) return null;
		let val = stats.mean;

		if (row.useStandardCurve) {
			const curve = row.curveId
				? standardCurves.find((c) => c.id === row.curveId)
				: activeCurveForParam(row.paramId);
			if (curve) {
				val = curve.slope * val + curve.intercept;
			}
		}
		return val;
	}

	function finalValue(row: SampleRow): number | null {
		if (row.overrideValue) return Number(row.overrideValue);
		return correctedValue(row);
	}

	function addRow() {
		rows = [...rows, { paramId: '', replicates: [''], useStandardCurve: false, curveId: '', overrideValue: '' }];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	function addReplicate(rowIndex: number) {
		if (rows[rowIndex].replicates.length < 10) {
			rows[rowIndex].replicates = [...rows[rowIndex].replicates, ''];
		}
	}

	function removeReplicate(rowIndex: number, repIndex: number) {
		if (rows[rowIndex].replicates.length > 1) {
			rows[rowIndex].replicates = rows[rowIndex].replicates.filter((_, i) => i !== repIndex);
		}
	}

	async function handleSubmit() {
		if (!selectedSiteId || rows.length === 0) return;
		submitting = true;
		try {
			const issues: string[] = [];
			const readings: { parameter_id: string; time: string; value: number; replicate_index: number }[] = [];

			rows.forEach((row, idx) => {
				if (isRowEmpty(row)) return;
				const label = `Row ${idx + 1}`;
				const sp = filteredParams.find((fp) => fp.parameter_id === row.paramId);
				if (!sp) {
					issues.push(`${label}: select a parameter`);
					return;
				}
				const stats = replicateStats(row);
				if (!stats) {
					issues.push(`${label} (${paramName(row.paramId)}): enter at least one numeric replicate`);
					return;
				}
				const time = new Date(sampleDate).toISOString();
				for (let i = 0; i < stats.values.length; i++) {
					let val = stats.values[i];
					if (row.useStandardCurve) {
						const curve = row.curveId
							? standardCurves.find((c) => c.id === row.curveId)
							: activeCurveForParam(row.paramId);
						if (curve) val = curve.slope * stats.values[i] + curve.intercept;
					}
					readings.push({ parameter_id: row.paramId, time, value: val, replicate_index: i });
				}
			});

			if (issues.length > 0) {
				toastStore.error(`Fix the following before submitting: ${issues.join('; ')}`);
				return;
			}
			if (readings.length === 0) {
				toastStore.error('No readings to submit — add a parameter row with at least one replicate');
				return;
			}

			const res = await POST<{ inserted: number; samples_created: number }>(
				'/api/grab_samples',
				{ site_id: selectedSiteId, readings },
			);
			toastStore.success(`Submitted ${res.inserted} readings (${res.samples_created} samples created)`);
			rows = [];
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Submit failed');
		} finally { submitting = false; }
	}

	onMount(async () => {
		try {
			const [p, s, sp, par, sc] = await Promise.all([
				api.projects.list({ perPage: 100 }),
				api.sites.list({ perPage: 200 }),
				api.siteParameters.list({ perPage: 1000 }),
				api.parameters.list({ perPage: 500 }),
				api.standardCurves.list({ perPage: 200 }),
			]);
			projects = p.data;
			sites = s.data;
			siteParams = sp.data;
			params = par.data;
			standardCurves = sc.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load';
		} finally { loading = false; }
	});
</script>

<svelte:head><title>Grab Samples | River Data</title></svelte:head>

<div class="space-y-6 max-w-4xl">
	<h2 class="text-xl font-semibold">Grab Sample Entry</h2>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else if error}
		<p class="text-severity-alarm">{error}</p>
	{:else}
		<!-- Header fields -->
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<div>
				<label for="project" class="text-sm font-medium block mb-1">Project</label>
				<select id="project" bind:value={selectedProjectId} onchange={() => selectedSiteId = ''} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="">All projects</option>
					{#each projects as p}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</div>
			<div>
				<label for="site" class="text-sm font-medium block mb-1">Site <span class="text-severity-alarm">*</span></label>
				<select id="site" bind:value={selectedSiteId} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="">-- Select site --</option>
					{#each filteredSites as s}<option value={s.id}>{s.name}</option>{/each}
				</select>
			</div>
			<div>
				<label for="date" class="text-sm font-medium block mb-1">Date/Time <span class="text-severity-alarm">*</span></label>
				<input id="date" type="datetime-local" bind:value={sampleDate} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>
		</div>

		<!-- Parameter rows -->
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold">Readings</h3>
				<button onclick={addRow} disabled={!selectedSiteId} class="px-3 py-1 text-sm bg-brand-primary text-white rounded-md cursor-pointer border-none disabled:opacity-50">+ Add Parameter</button>
			</div>

			{#each rows as row, i}
				{@const stats = replicateStats(row)}
				{@const corrected = correctedValue(row)}
				{@const final_ = finalValue(row)}
				{@const availableCurves = curvesForParam(row.paramId)}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-3 space-y-3">
					<!-- Parameter selector + remove -->
					<div class="flex items-center gap-3">
						<select bind:value={row.paramId} class="flex-1 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value="">-- Parameter --</option>
							{#each filteredParams as sp}
								<option value={sp.parameter_id}>{paramName(sp.parameter_id)} ({paramUnits(sp)})</option>
							{/each}
						</select>
						<button onclick={() => removeRow(i)} class="text-severity-alarm bg-transparent border-none cursor-pointer text-sm hover:underline">Remove</button>
					</div>

					<!-- Replicates -->
					<div class="space-y-1.5">
						<span class="text-xs text-brand-muted font-semibold">Replicates</span>
						<div class="flex items-center gap-2 flex-wrap">
							{#each row.replicates as _, j}
								<div class="flex items-center gap-0.5">
									<input
										type="number"
										step="any"
										bind:value={row.replicates[j]}
										placeholder="Rep {j + 1}"
										class="w-24 px-2 py-1 border border-brand-divider rounded text-sm bg-brand-surface"
									/>
									{#if row.replicates.length > 1}
										<button onclick={() => removeReplicate(i, j)} class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer">x</button>
									{/if}
								</div>
							{/each}
							{#if row.replicates.length < 10}
								<button onclick={() => addReplicate(i)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">+ Rep</button>
							{/if}
						</div>
					</div>

					<!-- Inline statistics -->
					{#if stats}
						<div class="flex gap-4 text-xs bg-brand-bg rounded px-3 py-1.5">
							<span><span class="text-brand-muted">n:</span> {stats.n}</span>
							<span><span class="text-brand-muted">Mean:</span> <span class="font-mono">{stats.mean.toPrecision(5)}</span></span>
							{#if stats.n > 1}
								<span><span class="text-brand-muted">SD:</span> <span class="font-mono">{stats.sd.toPrecision(4)}</span></span>
							{/if}
						</div>
					{/if}

					<!-- Standard curve correction -->
					{#if row.paramId && availableCurves.length > 0}
						<div class="flex items-center gap-3">
							<label class="flex items-center gap-1.5 text-xs cursor-pointer">
								<input type="checkbox" bind:checked={row.useStandardCurve} class="accent-brand-primary" />
								Standard curve correction
							</label>
							{#if row.useStandardCurve}
								<select bind:value={row.curveId} class="px-2 py-1 border border-brand-divider rounded text-xs bg-brand-surface">
									<option value="">Auto (latest valid)</option>
									{#each availableCurves as curve}
										<option value={curve.id}>
											{new Date(curve.valid_from).toLocaleDateString()} (y={curve.slope.toFixed(4)}x+{curve.intercept.toFixed(4)}, R²={curve.r_squared?.toFixed(4) ?? '?'})
										</option>
									{/each}
								</select>
							{/if}
						</div>
					{/if}

					<!-- Corrected value + override -->
					{#if stats}
						<div class="flex items-center gap-4 text-xs">
							{#if corrected != null}
								<span>
									<span class="text-brand-muted">{row.useStandardCurve ? 'Corrected:' : 'Value:'}</span>
									<span class="font-mono font-semibold">{corrected.toPrecision(5)}</span>
								</span>
							{/if}
							<div class="flex items-center gap-1.5">
								<label for="override-{i}" class="text-brand-muted">Override:</label>
								<input
									id="override-{i}"
									type="number"
									step="any"
									bind:value={row.overrideValue}
									placeholder="--"
									class="w-28 px-2 py-0.5 border border-brand-divider rounded text-xs bg-brand-surface"
								/>
							</div>
							{#if final_ != null}
								<span class="ml-auto font-semibold text-severity-ok">
									Final: <span class="font-mono">{final_.toPrecision(5)}</span>
								</span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}

			{#if rows.length === 0}
				<p class="text-sm text-brand-muted text-center py-6">Click "Add Parameter" to start entering grab sample readings</p>
			{/if}
		</div>

		{#if rows.length > 0}
			<button
				onclick={handleSubmit}
				disabled={submitting || !selectedSiteId}
				class="px-4 py-2 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50"
			>
				{submitting ? 'Submitting...' : 'Submit Grab Samples'}
			</button>
		{/if}
	{/if}
</div>
