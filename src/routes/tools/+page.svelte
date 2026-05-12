<script lang="ts">
	import { POST } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface Tool {
		name: string;
		title: string;
		description: string;
		domain: string;
		inputs: Array<{ key: string; label: string; type: 'number' | 'text' | 'file'; required?: boolean; unit?: string; step?: string }>;
	}

	const tools: Tool[] = [
		{ name: 'discharge', title: 'Discharge', description: 'Tracer dilution discharge calculation', domain: 'Hydrology',
			inputs: [
				{ key: 'tracer_mass_g', label: 'Tracer mass', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'background_concentration', label: 'Background concentration', type: 'number', unit: 'mg/L', step: 'any' },
				{ key: 'peak_concentration', label: 'Peak concentration', type: 'number', required: true, unit: 'mg/L', step: 'any' },
				{ key: 'integral', label: 'Integral (concentration × time)', type: 'number', required: true, step: 'any' },
			]
		},
		{ name: 'doc', title: 'DOC', description: 'Dissolved organic carbon from absorbance', domain: 'Carbon',
			inputs: [
				{ key: 'absorbance_254', label: 'Absorbance at 254 nm', type: 'number', required: true, step: 'any' },
				{ key: 'path_length_cm', label: 'Path length', type: 'number', unit: 'cm', step: 'any' },
			]
		},
		{ name: 'dic', title: 'DIC', description: 'Dissolved inorganic carbon', domain: 'Carbon',
			inputs: [
				{ key: 'ph', label: 'pH', type: 'number', required: true, step: 'any' },
				{ key: 'alkalinity_meq_l', label: 'Alkalinity', type: 'number', required: true, unit: 'meq/L', step: 'any' },
				{ key: 'temperature_c', label: 'Temperature', type: 'number', unit: '°C', step: 'any' },
			]
		},
		{ name: 'pco2', title: 'pCO₂', description: 'Partial pressure of CO₂', domain: 'Carbon',
			inputs: [
				{ key: 'ph', label: 'pH', type: 'number', required: true, step: 'any' },
				{ key: 'dic_mg_l', label: 'DIC', type: 'number', required: true, unit: 'mg/L', step: 'any' },
				{ key: 'temperature_c', label: 'Temperature', type: 'number', unit: '°C', step: 'any' },
			]
		},
		{ name: 'alkalinity', title: 'Alkalinity', description: 'Gran titration alkalinity', domain: 'Ions',
			inputs: [
				{ key: 'sample_volume_ml', label: 'Sample volume', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'acid_normality', label: 'Acid normality', type: 'number', required: true, unit: 'N', step: 'any' },
				{ key: 'endpoint_volume_ml', label: 'Endpoint volume', type: 'number', required: true, unit: 'mL', step: 'any' },
			]
		},
		{ name: 'nutrients', title: 'Nutrients', description: 'N/P species concentrations', domain: 'Nutrients',
			inputs: [
				{ key: 'absorbance', label: 'Absorbance', type: 'number', required: true, step: 'any' },
				{ key: 'standard_slope', label: 'Standard curve slope', type: 'number', required: true, step: 'any' },
				{ key: 'standard_intercept', label: 'Standard curve intercept', type: 'number', step: 'any' },
				{ key: 'dilution_factor', label: 'Dilution factor', type: 'number', step: 'any' },
			]
		},
		{ name: 'tss_afdm', title: 'TSS / AFDM', description: 'Total suspended solids and ash-free dry mass', domain: 'Suspended',
			inputs: [
				{ key: 'filter_dry_g', label: 'Filter dry weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'filter_wet_g', label: 'Filter + sample dry weight', type: 'number', required: true, unit: 'g', step: 'any' },
				{ key: 'filter_ashed_g', label: 'Filter ashed weight', type: 'number', unit: 'g', step: 'any' },
				{ key: 'volume_filtered_l', label: 'Volume filtered', type: 'number', required: true, unit: 'L', step: 'any' },
			]
		},
		{ name: 'chlorophyll', title: 'Chlorophyll-a', description: 'Chlorophyll-a from acetone extraction', domain: 'Field',
			inputs: [
				{ key: 'absorbance_665', label: 'Abs. 665 nm (before acid)', type: 'number', required: true, step: 'any' },
				{ key: 'absorbance_665_acid', label: 'Abs. 665 nm (after acid)', type: 'number', required: true, step: 'any' },
				{ key: 'extract_volume_ml', label: 'Extract volume', type: 'number', required: true, unit: 'mL', step: 'any' },
				{ key: 'filter_area_cm2', label: 'Filter area', type: 'number', unit: 'cm²', step: 'any' },
				{ key: 'path_length_cm', label: 'Path length', type: 'number', unit: 'cm', step: 'any' },
			]
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
	let result = $state<Record<string, unknown> | null>(null);
	let calculating = $state(false);

	function selectTool(tool: Tool) {
		activeTool = tool;
		inputValues = {};
		result = null;
		for (const inp of tool.inputs) {
			inputValues[inp.key] = '';
		}
	}

	async function calculate() {
		if (!activeTool) return;
		calculating = true;
		result = null;
		try {
			const payload: Record<string, unknown> = {};
			for (const inp of activeTool.inputs) {
				const v = inputValues[inp.key];
				if (inp.type === 'number' && v) payload[inp.key] = Number(v);
				else if (v) payload[inp.key] = v;
			}
			result = await POST<Record<string, unknown>>(`/api/service/tools/${activeTool.name}/calculate`, payload);
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
		<!-- Tool catalog -->
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
		<!-- Tool runner -->
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
								<input
									id={inp.key}
									type={inp.type === 'number' ? 'number' : 'text'}
									step={inp.step}
									bind:value={inputValues[inp.key]}
									class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
								/>
							</div>
						{/each}
						<button type="submit" disabled={calculating} class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none disabled:opacity-50">
							{calculating ? 'Calculating...' : 'Calculate'}
						</button>
					</form>
				</div>
			</div>

			<!-- Results -->
			<div>
				{#if result}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
						<h3 class="text-sm font-semibold mb-3">Results</h3>
						<div class="space-y-2">
							{#each Object.entries(result) as [key, value]}
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
