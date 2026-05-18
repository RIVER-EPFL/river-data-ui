<script lang="ts">
	import { POST } from '$api/client';
	import { api } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface ToolInput {
		key: string;
		label: string;
		type: 'number' | 'text' | 'select' | 'array';
		required?: boolean;
		unit?: string;
		step?: string;
		options?: Array<{ value: string; label: string }>;
		arrayItemLabel?: string;
	}

	interface Tool {
		name: string;
		title: string;
		description: string;
		domain: string;
		inputs: ToolInput[];
		buildPayload?: (values: Record<string, string>, arrayValues: Record<string, string[]>) => Record<string, unknown>;
	}

	const tools: Tool[] = [
		// ── DOC ──
		{
			name: 'doc', title: 'DOC', description: 'Dissolved organic carbon from replicate absorbance values', domain: 'Carbon',
			inputs: [
				{ key: 'replicates', label: 'Replicate values', type: 'array', required: true, arrayItemLabel: 'Value' },
				{ key: 'std_slope', label: 'Std curve slope', type: 'number', step: 'any' },
				{ key: 'std_intercept', label: 'Std curve intercept', type: 'number', step: 'any' },
			],
			buildPayload: (v, arr) => {
				const reps = (arr['replicates'] ?? []).map(Number).filter((n) => !isNaN(n));
				const payload: Record<string, unknown> = { replicates: reps };
				if (v['std_slope'] && v['std_intercept']) {
					payload.std_curve = { slope: Number(v['std_slope']), intercept: Number(v['std_intercept']) };
				}
				return payload;
			},
		},
		// ── DIC ──
		{
			name: 'dic', title: 'DIC', description: 'Dissolved inorganic carbon via acid digestion + Picarro', domain: 'Carbon',
			inputs: [
				{ key: 'acid_sample_weight_g', label: 'Acid sample weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'acid_weight_g', label: 'Acid weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'vol_overpressure_ml', label: 'Volume overpressure', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'sa_added_ml', label: 'Sample added', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'co2_dry_ppm', label: 'CO₂ dry', type: 'number', required: true, unit: 'ppm', step: 'any' },
				{ key: 'lab_temp_c', label: 'Lab temperature', type: 'number', required: true, unit: '°C', step: 'any' },
				{ key: 'd13co2_permil', label: 'δ¹³CO₂', type: 'number', unit: '‰', step: 'any' },
			],
		},
		// ── pCO2 (simple mode) ──
		{
			name: 'pco2', title: 'pCO₂', description: 'Partial pressure of CO₂ from dissolved CO₂', domain: 'Carbon',
			inputs: [
				{ key: 'co2_aq_umol', label: 'Dissolved CO₂', type: 'number', required: true, unit: 'µmol', step: 'any' },
				{ key: 'water_temp_c', label: 'Water temperature', type: 'number', required: true, unit: '°C', step: 'any' },
				{ key: 'pressure_hpa', label: 'Barometric pressure', type: 'number', unit: 'hPa', step: 'any' },
				{
					key: 'variant', label: 'Variant', type: 'select',
					options: [
						{ value: 'simple', label: 'Simple (no pressure)' },
						{ value: 'p1', label: 'P1 (pressure corrected)' },
						{ value: 'p2', label: 'P2 (pressure corrected)' },
					],
				},
			],
		},
		// ── CO2/CH4 Air ──
		{
			name: 'co2_air', title: 'CO₂/CH₄ Air', description: 'Dry concentration from wet Picarro measurements', domain: 'Carbon',
			inputs: [
				{ key: 'h2o_percent', label: 'H₂O', type: 'number', required: true, unit: '%', step: 'any' },
				{ key: 'co2_wet', label: 'CO₂ wet', type: 'number', unit: 'ppm', step: 'any' },
				{ key: 'ch4_wet', label: 'CH₄ wet', type: 'number', unit: 'ppm', step: 'any' },
			],
		},
		// ── DOM Indices ──
		{
			name: 'dom', title: 'DOM Indices', description: 'SUVA and fluorescence peak ratios from UV-Vis', domain: 'Carbon',
			inputs: [
				{ key: 'a254', label: 'Absorbance 254 nm', type: 'number', step: 'any' },
				{ key: 'doc_avg_ppb', label: 'DOC concentration', type: 'number', unit: 'ppb', step: 'any' },
				{ key: 'abs_numerator', label: 'Absorbance ratio numerator', type: 'number', step: 'any' },
				{ key: 'abs_denominator', label: 'Absorbance ratio denominator', type: 'number', step: 'any' },
				{ key: 'peak_a', label: 'Peak A', type: 'number', step: 'any' },
				{ key: 'peak_c', label: 'Peak C', type: 'number', step: 'any' },
				{ key: 'peak_m', label: 'Peak M', type: 'number', step: 'any' },
				{ key: 'peak_t', label: 'Peak T', type: 'number', step: 'any' },
			],
		},
		// ── Alkalinity ──
		{
			name: 'alkalinity', title: 'Alkalinity', description: 'Gran titration alkalinity', domain: 'Ions',
			inputs: [
				{ key: 'sample_weight_g', label: 'Sample weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'acid_normality', label: 'Acid normality', type: 'number', required: true, unit: 'N', step: 'any' },
				{ key: 'titrant_volume_ml', label: 'Titrant volume', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'initial_ph', label: 'Initial pH', type: 'number', step: 'any' },
			],
		},
		// ── Nutrients ──
		{
			name: 'nutrients', title: 'Nutrients', description: 'Nutrient concentration from replicates', domain: 'Nutrients',
			inputs: [
				{ key: 'replicates', label: 'Replicate values', type: 'array', required: true, arrayItemLabel: 'Concentration' },
				{ key: 'nox', label: 'NOx', type: 'number', unit: 'µg/L', step: 'any' },
				{ key: 'no2', label: 'NO₂', type: 'number', unit: 'µg/L', step: 'any' },
			],
			buildPayload: (v, arr) => {
				const reps = (arr['replicates'] ?? []).map(Number).filter((n) => !isNaN(n));
				const payload: Record<string, unknown> = { replicates: reps };
				if (v['nox']) payload.nox = Number(v['nox']);
				if (v['no2']) payload.no2 = Number(v['no2']);
				return payload;
			},
		},
		// ── TSS / AFDM ──
		{
			name: 'tss_afdm', title: 'TSS / AFDM', description: 'Total suspended solids and ash-free dry mass', domain: 'Suspended',
			inputs: [
				{ key: 'wgt_dried_g', label: 'Filter + sample dried weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'wgt_prefilt_g', label: 'Pre-filtration filter weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'wgt_ashed_g', label: 'Ashed weight', type: 'number', unit: 'g', step: 'any' },
				{ key: 'vol_filtered_ml', label: 'Volume filtered', type: 'number', required: true, unit: 'mL', step: 'any' },
			],
		},
		// ── Chlorophyll ──
		{
			name: 'chlorophyll', title: 'Chlorophyll-a', description: 'Chlorophyll-a from fluorescence + standard curve', domain: 'Field',
			inputs: [
				{
					key: 'method', label: 'Method', type: 'select', required: true,
					options: [
						{ value: 'acid', label: 'Acid correction' },
						{ value: 'no_acid', label: 'No acid' },
					],
				},
				{ key: 'fluorescence_before', label: 'Fluorescence (before acid)', type: 'number', required: true, step: 'any' },
				{ key: 'fluorescence_after', label: 'Fluorescence (after acid)', type: 'number', step: 'any' },
				{ key: 'slope', label: 'Std curve slope', type: 'number', required: true, step: 'any' },
				{ key: 'intercept', label: 'Std curve intercept', type: 'number', required: true, step: 'any' },
			],
		},
		// ── Ions (Charge Balance) ──
		{
			name: 'ions', title: 'Ion Charge Balance', description: 'Charge balance from cation/anion concentrations', domain: 'Ions',
			inputs: [],
			buildPayload: (_v, _arr) => {
				const cations = (ionRows.cations ?? []).filter((r) => r.name && r.value).map((r) => ({ name: r.name, concentration_mg_l: Number(r.value) }));
				const anions = (ionRows.anions ?? []).filter((r) => r.name && r.value).map((r) => ({ name: r.name, concentration_mg_l: Number(r.value) }));
				return { cations, anions };
			},
		},
		// ── Isotopes ──
		{
			name: 'isotopes', title: 'Isotopes', description: 'Deuterium excess and ¹⁷O excess', domain: 'Field',
			inputs: [
				{ key: 'd_d', label: 'δD (deuterium)', type: 'number', unit: '‰', step: 'any' },
				{ key: 'd18o', label: 'δ¹⁸O', type: 'number', unit: '‰', step: 'any' },
				{ key: 'd17o', label: 'δ¹⁷O', type: 'number', unit: '‰', step: 'any' },
			],
		},
		// ── Field Data ──
		{
			name: 'field_data', title: 'Field Data', description: 'Barometric pressure from altitude + CO₂ correction', domain: 'Hydrology',
			inputs: [
				{ key: 'elevation_m', label: 'Elevation', type: 'number', unit: 'm', step: 'any' },
				{ key: 'temp_c', label: 'Temperature', type: 'number', unit: '°C', step: 'any' },
				{ key: 'pressure_hpa', label: 'Measured pressure', type: 'number', unit: 'hPa', step: 'any' },
				{ key: 'raw_co2', label: 'Raw CO₂', type: 'number', unit: 'ppm', step: 'any' },
				{ key: 'std_slope', label: 'Std curve slope', type: 'number', step: 'any' },
				{ key: 'std_intercept', label: 'Std curve intercept', type: 'number', step: 'any' },
			],
			buildPayload: (v) => {
				const payload: Record<string, unknown> = {};
				for (const k of ['elevation_m', 'temp_c', 'pressure_hpa', 'raw_co2']) {
					if (v[k]) payload[k] = Number(v[k]);
				}
				if (v['std_slope'] && v['std_intercept']) {
					payload.std_curve = { slope: Number(v['std_slope']), intercept: Number(v['std_intercept']) };
				}
				return payload;
			},
		},
		// ── Benthic ──
		{
			name: 'benthic', title: 'Benthic', description: 'Rock surface area and per-m² normalization', domain: 'Suspended',
			inputs: [
				{ key: 'diameters_cm', label: 'Rock diameters', type: 'array', required: true, arrayItemLabel: 'Diameter (cm)' },
				{ key: 'volume_filtered_ml', label: 'Volume filtered', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'total_volume_ml', label: 'Total volume', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'afdm_g_filter', label: 'AFDM on filter', type: 'number', unit: 'g', step: 'any' },
				{ key: 'chla_ug_l', label: 'Chlorophyll-a', type: 'number', unit: 'µg/L', step: 'any' },
			],
			buildPayload: (v, arr) => {
				const diameters = (arr['diameters_cm'] ?? []).map(Number).filter((n) => !isNaN(n));
				const payload: Record<string, unknown> = {
					diameters_cm: diameters,
					volume_filtered_ml: Number(v['volume_filtered_ml']),
					total_volume_ml: Number(v['total_volume_ml']),
				};
				if (v['afdm_g_filter']) payload.afdm_g_filter = Number(v['afdm_g_filter']);
				if (v['chla_ug_l']) payload.chla_ug_l = Number(v['chla_ug_l']);
				return payload;
			},
		},
		// ── Chla-Benthic (multi-replicate) ──
		{
			name: 'chla_benthic', title: 'Chla-Benthic', description: 'Multi-replicate chlorophyll + benthic + AFDM', domain: 'Field',
			inputs: [
				{ key: 'acid_slope', label: 'Acid std curve slope', type: 'number', required: true, step: 'any' },
				{ key: 'acid_intercept', label: 'Acid std curve intercept', type: 'number', required: true, step: 'any' },
				{ key: 'noacid_slope', label: 'No-acid std curve slope', type: 'number', required: true, step: 'any' },
				{ key: 'noacid_intercept', label: 'No-acid std curve intercept', type: 'number', required: true, step: 'any' },
			],
			buildPayload: (v) => ({
				acid_slope: Number(v['acid_slope']),
				acid_intercept: Number(v['acid_intercept']),
				noacid_slope: Number(v['noacid_slope']),
				noacid_intercept: Number(v['noacid_intercept']),
				replicates: chlaBenthicReps.filter((r) => r.fluor_before).map((r) => ({
					fluor_before: Number(r.fluor_before),
					fluor_after: r.fluor_after ? Number(r.fluor_after) : null,
					vol_total_ml: Number(r.vol_total_ml),
					vol_after_ml: Number(r.vol_after_ml),
					diameters_cm: r.diameters.split(',').map(Number).filter((n) => !isNaN(n)),
					afdm_g_filter: r.afdm_g_filter ? Number(r.afdm_g_filter) : null,
				})),
			}),
		},
	];

	const domains = [...new Set(tools.map((t) => t.domain))];
	const domainColors: Record<string, string> = {
		Hydrology: 'border-viz-0/50 bg-viz-0/5',
		Carbon: 'border-viz-1/50 bg-viz-1/5',
		Nutrients: 'border-viz-2/50 bg-viz-2/5',
		Suspended: 'border-viz-3/50 bg-viz-3/5',
		Ions: 'border-viz-5/50 bg-viz-5/5',
		Field: 'border-viz-4/50 bg-viz-4/5',
	};

	let activeTool = $state<Tool | null>(null);
	let inputValues = $state<Record<string, string>>({});
	let arrayValues = $state<Record<string, string[]>>({});
	let result = $state<Record<string, unknown> | null>(null);
	let calculating = $state(false);

	// Ion charge balance state
	let ionRows = $state<{
		cations: Array<{ name: string; value: string }>;
		anions: Array<{ name: string; value: string }>;
	}>({
		cations: [
			{ name: 'Ca', value: '' }, { name: 'Mg', value: '' }, { name: 'Na', value: '' },
			{ name: 'K', value: '' }, { name: 'NH4', value: '' },
		],
		anions: [
			{ name: 'Cl', value: '' }, { name: 'SO4', value: '' }, { name: 'HCO3', value: '' },
			{ name: 'NO3', value: '' },
		],
	});

	// Chla-benthic replicate state
	let chlaBenthicReps = $state<Array<{
		fluor_before: string; fluor_after: string;
		vol_total_ml: string; vol_after_ml: string;
		diameters: string; afdm_g_filter: string;
	}>>([
		{ fluor_before: '', fluor_after: '', vol_total_ml: '', vol_after_ml: '', diameters: '', afdm_g_filter: '' },
	]);

	function selectTool(tool: Tool) {
		activeTool = tool;
		inputValues = {};
		arrayValues = {};
		result = null;
		for (const inp of tool.inputs) {
			if (inp.type === 'array') {
				arrayValues[inp.key] = [''];
			} else if (inp.type === 'select' && inp.options?.length) {
				inputValues[inp.key] = inp.options[0].value;
			} else {
				inputValues[inp.key] = '';
			}
		}
		if (tool.name === 'ions') {
			ionRows = {
				cations: [{ name: 'Ca', value: '' }, { name: 'Mg', value: '' }, { name: 'Na', value: '' }, { name: 'K', value: '' }, { name: 'NH4', value: '' }],
				anions: [{ name: 'Cl', value: '' }, { name: 'SO4', value: '' }, { name: 'HCO3', value: '' }, { name: 'NO3', value: '' }],
			};
		}
		if (tool.name === 'chla_benthic') {
			chlaBenthicReps = [{ fluor_before: '', fluor_after: '', vol_total_ml: '', vol_after_ml: '', diameters: '', afdm_g_filter: '' }];
		}
	}

	function addArrayItem(key: string) {
		arrayValues[key] = [...(arrayValues[key] ?? []), ''];
	}

	function removeArrayItem(key: string, idx: number) {
		arrayValues[key] = (arrayValues[key] ?? []).filter((_, i) => i !== idx);
	}

	async function calculate() {
		if (!activeTool) return;
		calculating = true;
		result = null;
		try {
			let payload: Record<string, unknown>;
			if (activeTool.buildPayload) {
				payload = activeTool.buildPayload(inputValues, arrayValues);
			} else {
				payload = {};
				for (const inp of activeTool.inputs) {
					const v = inputValues[inp.key];
					if (inp.type === 'number' && v) payload[inp.key] = Number(v);
					else if (inp.type === 'select' && v) payload[inp.key] = v;
					else if (v) payload[inp.key] = v;
				}
			}
			const res = await POST<{ results: Record<string, unknown> }>(`/api/service/tools/${activeTool.name}/calculate`, payload);
			result = res.results;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Calculation failed');
		} finally { calculating = false; }
	}
</script>

<svelte:head><title>Tools | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Analytical Tools</h2>
		{#if activeTool}
			<button onclick={() => { activeTool = null; result = null; }} class="text-sm text-brand-primary bg-transparent border-none cursor-pointer hover:underline">&larr; All Tools</button>
		{/if}
	</div>

	{#if !activeTool}
		{#each domains as domain}
			<div>
				<h3 class="text-sm font-semibold text-brand-muted uppercase tracking-wider mb-2">{domain}</h3>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{#each tools.filter((t) => t.domain === domain) as tool}
						<button
							onclick={() => selectTool(tool)}
							class="text-left p-4 rounded-md border {domainColors[domain] ?? 'border-brand-divider bg-brand-surface'} cursor-pointer hover:shadow-sm transition-shadow"
						>
							<div class="font-semibold text-sm">{tool.title}</div>
							<div class="text-xs text-brand-muted mt-1">{tool.description}</div>
						</button>
					{/each}
				</div>
			</div>
		{/each}
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
			<div class="space-y-4">
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
					<h3 class="text-base font-semibold mb-1">{activeTool.title}</h3>
					<p class="text-sm text-brand-muted mb-4">{activeTool.description}</p>

					<form onsubmit={(e) => { e.preventDefault(); calculate(); }} class="space-y-3">
						{#each activeTool.inputs as inp}
							<div class="flex flex-col gap-1">
								<label for={inp.key} class="text-sm font-medium">
									{inp.label}
									{#if inp.unit}<span class="text-brand-muted font-normal">({inp.unit})</span>{/if}
									{#if inp.required}<span class="text-severity-alarm">*</span>{/if}
								</label>
								{#if inp.type === 'select'}
									<select
										id={inp.key}
										bind:value={inputValues[inp.key]}
										class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
									>
										{#each inp.options ?? [] as opt}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else if inp.type === 'array'}
									<div class="space-y-1.5">
										{#each arrayValues[inp.key] ?? [] as _, idx}
											<div class="flex gap-1.5">
												<input
													type="number"
													step="any"
													bind:value={arrayValues[inp.key][idx]}
													placeholder="{inp.arrayItemLabel ?? 'Value'} {idx + 1}"
													class="flex-1 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
												/>
												{#if (arrayValues[inp.key]?.length ?? 0) > 1}
													<button type="button" onclick={() => removeArrayItem(inp.key, idx)} class="px-2 text-severity-alarm bg-transparent border border-brand-divider rounded-md cursor-pointer text-xs">×</button>
												{/if}
											</div>
										{/each}
										<button type="button" onclick={() => addArrayItem(inp.key)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">+ Add replicate</button>
									</div>
								{:else}
									<input
										id={inp.key}
										type={inp.type === 'number' ? 'number' : 'text'}
										step={inp.step}
										bind:value={inputValues[inp.key]}
										class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
									/>
								{/if}
							</div>
						{/each}

						<!-- Ion charge balance custom UI -->
						{#if activeTool.name === 'ions'}
							<div class="space-y-3">
								<div>
									<span class="text-sm font-medium">Cations (mg/L)</span>
									{#each ionRows.cations as row, idx}
										<div class="flex gap-2 mt-1">
											<input type="text" bind:value={row.name} placeholder="Ion" class="w-20 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
											<input type="number" step="any" bind:value={row.value} placeholder="mg/L" class="flex-1 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
											<button type="button" onclick={() => { ionRows.cations = ionRows.cations.filter((_, i) => i !== idx); }} class="px-2 text-severity-alarm bg-transparent border border-brand-divider rounded-md cursor-pointer text-xs">×</button>
										</div>
									{/each}
									<button type="button" onclick={() => { ionRows.cations = [...ionRows.cations, { name: '', value: '' }]; }} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline mt-1">+ Add cation</button>
								</div>
								<div>
									<span class="text-sm font-medium">Anions (mg/L)</span>
									{#each ionRows.anions as row, idx}
										<div class="flex gap-2 mt-1">
											<input type="text" bind:value={row.name} placeholder="Ion" class="w-20 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
											<input type="number" step="any" bind:value={row.value} placeholder="mg/L" class="flex-1 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm" />
											<button type="button" onclick={() => { ionRows.anions = ionRows.anions.filter((_, i) => i !== idx); }} class="px-2 text-severity-alarm bg-transparent border border-brand-divider rounded-md cursor-pointer text-xs">×</button>
										</div>
									{/each}
									<button type="button" onclick={() => { ionRows.anions = [...ionRows.anions, { name: '', value: '' }]; }} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline mt-1">+ Add anion</button>
								</div>
							</div>
						{/if}

						<!-- Chla-benthic replicate table -->
						{#if activeTool.name === 'chla_benthic'}
							<div>
								<span class="text-sm font-medium">Replicates</span>
								<div class="overflow-x-auto mt-2">
									<table class="text-xs w-full">
										<thead><tr class="text-left">
											<th class="px-1 py-1">Fluor before</th>
											<th class="px-1 py-1">Fluor after</th>
											<th class="px-1 py-1">Vol total (mL)</th>
											<th class="px-1 py-1">Vol after (mL)</th>
											<th class="px-1 py-1">Diameters (cm, comma-sep)</th>
											<th class="px-1 py-1">AFDM (g)</th>
											<th class="px-1 py-1"></th>
										</tr></thead>
										<tbody>
											{#each chlaBenthicReps as rep, idx}
												<tr>
													<td class="px-1 py-0.5"><input type="number" step="any" bind:value={rep.fluor_before} class="w-full px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs" /></td>
													<td class="px-1 py-0.5"><input type="number" step="any" bind:value={rep.fluor_after} class="w-full px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs" /></td>
													<td class="px-1 py-0.5"><input type="number" step="any" bind:value={rep.vol_total_ml} class="w-full px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs" /></td>
													<td class="px-1 py-0.5"><input type="number" step="any" bind:value={rep.vol_after_ml} class="w-full px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs" /></td>
													<td class="px-1 py-0.5"><input type="text" bind:value={rep.diameters} placeholder="5.2,4.1,6.0" class="w-full px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs" /></td>
													<td class="px-1 py-0.5"><input type="number" step="any" bind:value={rep.afdm_g_filter} class="w-full px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs" /></td>
													<td class="px-1 py-0.5">
														{#if chlaBenthicReps.length > 1}
															<button type="button" onclick={() => { chlaBenthicReps = chlaBenthicReps.filter((_, i) => i !== idx); }} class="text-severity-alarm bg-transparent border-none cursor-pointer">×</button>
														{/if}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								<button type="button" onclick={() => { chlaBenthicReps = [...chlaBenthicReps, { fluor_before: '', fluor_after: '', vol_total_ml: '', vol_after_ml: '', diameters: '', afdm_g_filter: '' }]; }} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline mt-1">+ Add replicate</button>
							</div>
						{/if}

						<button type="submit" disabled={calculating} class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50">
							{calculating ? 'Calculating...' : 'Calculate'}
						</button>
					</form>
				</div>
			</div>

			<div>
				{#if result}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
						<h3 class="text-sm font-semibold mb-3">Results</h3>
						<div class="space-y-2">
							{#each Object.entries(result).filter(([, v]) => v != null) as [key, value]}
								<div class="flex justify-between text-sm border-b border-brand-divider pb-1 last:border-b-0">
									<span class="text-brand-muted">{key.replace(/_/g, ' ')}</span>
									<span class="font-mono">{typeof value === 'number' ? value.toPrecision(6) : String(value)}</span>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4 flex items-center justify-center h-40 text-sm text-brand-muted">
						Enter values and click Calculate
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
