<script lang="ts">
	import { POST } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import CurvePicker, {
		emptyCurveSelection,
		type CurveSelection,
	} from '$components/tools/CurvePicker.svelte';
	import SaveResultsPanel from '$components/tools/SaveResultsPanel.svelte';

	interface ScalarInput {
		key: string;
		label: string;
		unit?: string;
		required?: boolean;
		type?: 'number' | 'select';
		options?: Array<{ value: string; label: string }>;
		help?: string;
	}

	interface GridColumn {
		key: string;
		label: string;
		unit?: string;
		required?: boolean;
	}

	interface DerivedColumn {
		label: string;
		compute: (row: Record<string, string>) => number | null;
	}

	interface GridDef {
		key: string;
		title: string;
		columns: GridColumn[];
		defaultRows: number;
		rowLabel: (i: number) => string;
		fixedRows?: boolean;
		maxRows?: number;
		derived?: DerivedColumn[];
	}

	interface CurveDef {
		key: string;
		title: string;
		required?: boolean;
	}

	interface BuildCtx {
		scalars: Record<string, string>;
		grids: Record<string, Record<string, string>[]>;
		curves: Record<string, CurveSelection>;
	}

	type Built = { payload: Record<string, unknown> } | { error: string };

	interface Tool {
		name: string;
		title: string;
		description: string;
		domain: string;
		scalars?: ScalarInput[];
		grids?: GridDef[];
		curves?: CurveDef[];
		buildPayload: (ctx: BuildCtx) => Built;
	}

	const letter = (i: number) => String.fromCharCode(65 + i);
	const num = (s: string | undefined): number | null =>
		s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;

	// Scalar fields translate 1:1 into payload keys; required fields must parse.
	function scalarPayload(defs: ScalarInput[], values: Record<string, string>): Built {
		const payload: Record<string, unknown> = {};
		for (const d of defs) {
			const v = values[d.key];
			if (d.type === 'select') {
				if (v) payload[d.key] = v;
				continue;
			}
			const n = num(v);
			if (n === null) {
				if (d.required) return { error: `${d.label} is required` };
				continue;
			}
			payload[d.key] = n;
		}
		return { payload };
	}

	function curvePair(sel: CurveSelection): { slope: number; intercept: number } | null {
		return sel.slope !== null && sel.intercept !== null
			? { slope: sel.slope, intercept: sel.intercept }
			: null;
	}

	// Species keys as the API expects them. SRP has no NUT_ column in the portal, so it keeps the
	// legacy SRP_*_ugL series; NH4 exists in both families and current entry goes to NUT_NH4_*.
	const NUTRIENT_SPECIES = ['P', 'NUT_NH4', 'SRP', 'NOx', 'NO2', 'TDP', 'TDN'];
	const NUTRIENT_LABELS = ['P', 'NH4', 'SRP', 'NOx', 'NO2', 'TDP', 'TDN'];

	const tools: Tool[] = [
		{
			name: 'doc',
			title: 'DOC',
			description: 'Dissolved organic carbon replicates with optional standard-curve correction',
			domain: 'Carbon',
			grids: [
				{
					key: 'replicates',
					title: 'Replicates',
					columns: [{ key: 'value', label: 'DOC', unit: 'ppb', required: true }],
					defaultRows: 3,
					rowLabel: (i) => `${i + 1}`,
				},
			],
			curves: [{ key: 'std_curve', title: 'Standard curve correction' }],
			buildPayload: ({ grids, curves }) => {
				const reps = grids['replicates']
					.map((r) => num(r['value']))
					.filter((n): n is number => n !== null);
				if (reps.length === 0) return { error: 'Enter at least one replicate' };
				const c = curvePair(curves['std_curve']);
				return { payload: { replicates: reps, ...(c ? { std_curve: c } : {}) } };
			},
		},
		{
			name: 'dic',
			title: 'DIC',
			description: 'Dissolved inorganic carbon via acid digestion, replicate A/B pairs',
			domain: 'Carbon',
			scalars: [
				{
					key: 'lab_temp_c',
					label: 'Lab temperature',
					unit: '°C',
					help: 'Falls back to the lab_temp_avg_degC constant when empty',
				},
			],
			grids: [
				{
					key: 'reps',
					title: 'Replicates',
					columns: [
						{ key: 'acid_sample_weight_g', label: 'Acid+sample wgt', unit: 'g', required: true },
						{ key: 'acid_weight_g', label: 'Acid wgt', unit: 'g', required: true },
						{ key: 'vol_overpressure_ml', label: 'Vol overpressure', unit: 'mL', required: true },
						{ key: 'sa_added_ml', label: 'SA added', unit: 'mL', required: true },
						{ key: 'co2_dry_ppm', label: 'CO₂ dry', unit: 'ppm', required: true },
						{ key: 'd13co2_permil', label: 'δ¹³CO₂', unit: '‰' },
					],
					defaultRows: 2,
					fixedRows: true,
					rowLabel: letter,
				},
			],
			buildPayload: ({ scalars, grids }) => {
				const grid = grids['reps'];
				const readRep = (row: Record<string, string>) => ({
					acid_sample_weight_g: num(row['acid_sample_weight_g']),
					acid_weight_g: num(row['acid_weight_g']),
					vol_overpressure_ml: num(row['vol_overpressure_ml']),
					sa_added_ml: num(row['sa_added_ml']),
					co2_dry_ppm: num(row['co2_dry_ppm']),
					d13co2_permil: num(row['d13co2_permil']),
				});
				const a = readRep(grid[0]);
				if (
					a.acid_sample_weight_g === null ||
					a.acid_weight_g === null ||
					a.vol_overpressure_ml === null ||
					a.sa_added_ml === null ||
					a.co2_dry_ppm === null
				) {
					return { error: 'Replicate A needs all five weight/volume/CO₂ fields' };
				}
				const payload: Record<string, unknown> = { ...a };
				const labTemp = num(scalars['lab_temp_c']);
				if (labTemp !== null) payload.lab_temp_c = labTemp;
				const bRow = grid[1];
				const bFilled = Object.values(bRow).some((v) => v !== '');
				if (bFilled) {
					const b = readRep(bRow);
					if (
						b.acid_sample_weight_g === null ||
						b.acid_weight_g === null ||
						b.vol_overpressure_ml === null ||
						b.sa_added_ml === null ||
						b.co2_dry_ppm === null
					) {
						return { error: 'Replicate B needs all five weight/volume/CO₂ fields (or clear it)' };
					}
					payload.replicate_b = b;
				}
				return { payload };
			},
		},
		{
			name: 'pco2',
			title: 'pCO₂',
			description: 'Headspace pCO₂ full pipeline with replicate A/B chains',
			domain: 'Carbon',
			scalars: [
				{ key: 'water_temp_c', label: 'Water temperature', unit: '°C', required: true },
				{ key: 'pressure_hpa', label: 'Field barometric pressure', unit: 'hPa', required: true },
				{ key: 'lab_temp_c', label: 'Lab temperature', unit: '°C', required: true },
				{ key: 'lab_pressure_atm', label: 'Lab pressure', unit: 'atm', required: true },
				{ key: 'vol_sa_ml', label: 'Vol standard air', unit: 'mL', required: true },
				{ key: 'vol_water_ml', label: 'Vol water', unit: 'mL', required: true },
			],
			grids: [
				{
					key: 'reps',
					title: 'Headspace replicates',
					columns: [
						{ key: 'co2_ppm', label: 'CO₂', unit: 'ppm', required: true },
						{ key: 'h2o_percent', label: 'H₂O', unit: '%', required: true },
						{ key: 'ch4_ppm', label: 'CH₄', unit: 'ppm', required: true },
						{ key: 'd13co2_permil', label: 'δ¹³CO₂', unit: '‰' },
					],
					defaultRows: 2,
					fixedRows: true,
					rowLabel: letter,
				},
			],
			buildPayload: ({ scalars, grids, curves: _c }) => {
				const base = scalarPayload(
					[
						{ key: 'water_temp_c', label: 'Water temperature', required: true },
						{ key: 'pressure_hpa', label: 'Field barometric pressure', required: true },
						{ key: 'lab_temp_c', label: 'Lab temperature', required: true },
						{ key: 'lab_pressure_atm', label: 'Lab pressure', required: true },
						{ key: 'vol_sa_ml', label: 'Vol standard air', required: true },
						{ key: 'vol_water_ml', label: 'Vol water', required: true },
					],
					scalars,
				);
				if ('error' in base) return base;
				const grid = grids['reps'];
				const a = {
					co2_ppm: num(grid[0]['co2_ppm']),
					h2o_percent: num(grid[0]['h2o_percent']),
					ch4_ppm: num(grid[0]['ch4_ppm']),
					d13co2_permil: num(grid[0]['d13co2_permil']),
				};
				if (a.co2_ppm === null || a.h2o_percent === null || a.ch4_ppm === null) {
					return { error: 'Replicate A needs CO₂, H₂O and CH₄' };
				}
				const payload: Record<string, unknown> = {
					...base.payload,
					mode: 'full_pipeline',
					co2_ppm: a.co2_ppm,
					h2o_percent: a.h2o_percent,
					ch4_ppm: a.ch4_ppm,
					...(a.d13co2_permil !== null ? { d13co2_permil: a.d13co2_permil } : {}),
				};
				const bRow = grid[1];
				if (Object.values(bRow).some((v) => v !== '')) {
					const b = {
						co2_ppm: num(bRow['co2_ppm']),
						h2o_percent: num(bRow['h2o_percent']),
						ch4_ppm: num(bRow['ch4_ppm']),
						d13co2_permil: num(bRow['d13co2_permil']),
					};
					if (b.co2_ppm === null || b.h2o_percent === null || b.ch4_ppm === null) {
						return { error: 'Replicate B needs CO₂, H₂O and CH₄ (or clear it)' };
					}
					payload.replicate_b = b;
				}
				return { payload };
			},
		},
		{
			name: 'co2_air',
			title: 'CO₂/CH₄ Air',
			description: 'CH₄ dry concentration from wet Picarro measurement',
			domain: 'Carbon',
			scalars: [
				{ key: 'ch4_wet', label: 'CH₄ wet', unit: 'ppm', required: true },
				{ key: 'h2o_percent', label: 'H₂O', unit: '%', required: true },
			],
			buildPayload: ({ scalars }) =>
				scalarPayload(
					[
						{ key: 'ch4_wet', label: 'CH₄ wet', required: true },
						{ key: 'h2o_percent', label: 'H₂O', required: true },
					],
					scalars,
				),
		},
		{
			name: 'dom',
			title: 'DOM Indices',
			description: 'SUVA and absorbance/fluorescence peak ratios from UV-Vis',
			domain: 'Carbon',
			scalars: [
				{ key: 'a254', label: 'Absorbance 254 nm' },
				{ key: 'doc_avg_ppb', label: 'DOC concentration', unit: 'ppb' },
				{ key: 'abs_numerator', label: 'Absorbance ratio numerator' },
				{ key: 'abs_denominator', label: 'Absorbance ratio denominator' },
				{ key: 'peak_a', label: 'Peak A' },
				{ key: 'peak_c', label: 'Peak C' },
				{ key: 'peak_m', label: 'Peak M' },
				{ key: 'peak_t', label: 'Peak T' },
			],
			buildPayload: ({ scalars }) => {
				const built = scalarPayload(
					[
						{ key: 'a254', label: 'Absorbance 254 nm' },
						{ key: 'doc_avg_ppb', label: 'DOC concentration' },
						{ key: 'abs_numerator', label: 'Absorbance ratio numerator' },
						{ key: 'abs_denominator', label: 'Absorbance ratio denominator' },
						{ key: 'peak_a', label: 'Peak A' },
						{ key: 'peak_c', label: 'Peak C' },
						{ key: 'peak_m', label: 'Peak M' },
						{ key: 'peak_t', label: 'Peak T' },
					],
					scalars,
				);
				if ('error' in built) return built;
				if (Object.keys(built.payload).length === 0) return { error: 'Enter at least one value' };
				return built;
			},
		},
		{
			name: 'alkalinity',
			title: 'Alkalinity',
			description: 'Raw alkalinity entry; WTW pH is filled from initial pH when missing',
			domain: 'Ions',
			scalars: [
				{ key: 'Alk_meqL', label: 'Alkalinity', unit: 'meq/L' },
				{ key: 'Alk_mgL', label: 'Alkalinity', unit: 'mg/L' },
				{ key: 'Alk_w_weight_g', label: 'Water weight', unit: 'g' },
				{ key: 'Alk_dyn_pH', label: 'Dynamic pH' },
				{ key: 'Alk_dyn_trit', label: 'Dynamic titrant' },
				{ key: 'Alk_temp_degC', label: 'Temperature', unit: '°C' },
				{ key: 'Alk_init_pH', label: 'Initial pH' },
				{ key: 'WTW_pH_1', label: 'WTW pH', help: 'Left empty, this fills from initial pH' },
			],
			buildPayload: ({ scalars }) => {
				const built = scalarPayload(
					[
						{ key: 'Alk_meqL', label: 'Alkalinity (meq/L)' },
						{ key: 'Alk_mgL', label: 'Alkalinity (mg/L)' },
						{ key: 'Alk_w_weight_g', label: 'Water weight' },
						{ key: 'Alk_dyn_pH', label: 'Dynamic pH' },
						{ key: 'Alk_dyn_trit', label: 'Dynamic titrant' },
						{ key: 'Alk_temp_degC', label: 'Temperature' },
						{ key: 'Alk_init_pH', label: 'Initial pH' },
						{ key: 'WTW_pH_1', label: 'WTW pH' },
					],
					scalars,
				);
				if ('error' in built) return built;
				if (Object.keys(built.payload).length === 0) return { error: 'Enter at least one value' };
				return built;
			},
		},
		{
			name: 'nutrients',
			title: 'Nutrients',
			description: 'Species replicate grid; NO₃ is derived per replicate from NOx and NO₂',
			domain: 'Nutrients',
			grids: [
				{
					key: 'species',
					title: 'Species replicates (µg/L)',
					columns: [
						{ key: 'a', label: 'Rep A' },
						{ key: 'b', label: 'Rep B' },
						{ key: 'c', label: 'Rep C' },
					],
					defaultRows: NUTRIENT_SPECIES.length,
					fixedRows: true,
					rowLabel: (i) => NUTRIENT_LABELS[i],
				},
			],
			buildPayload: ({ grids }) => {
				const species: Record<string, number[]> = {};
				grids['species'].forEach((row, i) => {
					const reps = [row['a'], row['b'], row['c']]
						.map(num)
						.filter((n): n is number => n !== null);
					if (reps.length > 0) species[NUTRIENT_SPECIES[i]] = reps;
				});
				if (Object.keys(species).length === 0) return { error: 'Enter at least one replicate' };
				return { payload: { species } };
			},
		},
		{
			name: 'tss_afdm',
			title: 'TSS / AFDM',
			description: 'Total suspended solids and ash-free dry mass',
			domain: 'Suspended',
			scalars: [
				{ key: 'wgt_dried_g', label: 'Filter + sample dried weight', unit: 'g', required: true },
				{ key: 'wgt_prefilt_g', label: 'Pre-filtration filter weight', unit: 'g', required: true },
				{ key: 'wgt_ashed_g', label: 'Ashed weight', unit: 'g' },
				{ key: 'vol_filtered_ml', label: 'Volume filtered', unit: 'mL', required: true },
			],
			buildPayload: ({ scalars }) =>
				scalarPayload(
					[
						{ key: 'wgt_dried_g', label: 'Dried weight', required: true },
						{ key: 'wgt_prefilt_g', label: 'Pre-filtration weight', required: true },
						{ key: 'wgt_ashed_g', label: 'Ashed weight' },
						{ key: 'vol_filtered_ml', label: 'Volume filtered', required: true },
					],
					scalars,
				),
		},
		{
			name: 'benthic',
			title: 'Benthic',
			description: 'Rock surface area and per-m² normalization',
			domain: 'Suspended',
			scalars: [
				{ key: 'volume_filtered_ml', label: 'Volume filtered', unit: 'mL', required: true },
				{ key: 'total_volume_ml', label: 'Total volume', unit: 'mL', required: true },
				{ key: 'afdm_g_filter', label: 'AFDM on filter', unit: 'g' },
				{ key: 'chla_ug_l', label: 'Chlorophyll-a', unit: 'µg/L' },
			],
			grids: [
				{
					key: 'diameters',
					title: 'Rock diameters',
					columns: [{ key: 'value', label: 'Diameter', unit: 'cm', required: true }],
					defaultRows: 3,
					rowLabel: (i) => `${i + 1}`,
				},
			],
			buildPayload: ({ scalars, grids }) => {
				const built = scalarPayload(
					[
						{ key: 'volume_filtered_ml', label: 'Volume filtered', required: true },
						{ key: 'total_volume_ml', label: 'Total volume', required: true },
						{ key: 'afdm_g_filter', label: 'AFDM on filter' },
						{ key: 'chla_ug_l', label: 'Chlorophyll-a' },
					],
					scalars,
				);
				if ('error' in built) return built;
				const diameters = grids['diameters']
					.map((r) => num(r['value']))
					.filter((n): n is number => n !== null);
				if (diameters.length === 0) return { error: 'Enter at least one rock diameter' };
				return { payload: { ...built.payload, diameters_cm: diameters } };
			},
		},
		{
			name: 'chlorophyll',
			title: 'Chlorophyll-a',
			description: 'Chlorophyll-a from fluorescence with a standard curve',
			domain: 'Field',
			scalars: [
				{
					key: 'method',
					label: 'Method',
					type: 'select',
					required: true,
					options: [
						{ value: 'acid', label: 'Acid correction' },
						{ value: 'no_acid', label: 'No acid' },
					],
				},
				{ key: 'fluorescence_before', label: 'Fluorescence (before acid)', required: true },
				{ key: 'fluorescence_after', label: 'Fluorescence (after acid)' },
			],
			curves: [{ key: 'curve', title: 'Standard curve', required: true }],
			buildPayload: ({ scalars, curves }) => {
				const before = num(scalars['fluorescence_before']);
				if (before === null) return { error: 'Fluorescence (before acid) is required' };
				const after = num(scalars['fluorescence_after']);
				if (scalars['method'] === 'acid' && after === null) {
					return { error: 'Fluorescence (after acid) is required for the acid method' };
				}
				const c = curvePair(curves['curve']);
				if (!c) return { error: 'Select or enter a standard curve' };
				return {
					payload: {
						method: scalars['method'],
						fluorescence_before: before,
						...(after !== null ? { fluorescence_after: after } : {}),
						slope: c.slope,
						intercept: c.intercept,
					},
				};
			},
		},
		{
			name: 'chla_benthic',
			title: 'Chla-Benthic',
			description: 'Multi-replicate chlorophyll + AFDM per rock area (replicates A-E)',
			domain: 'Field',
			curves: [
				{ key: 'acid', title: 'Acid standard curve', required: true },
				{ key: 'noacid', title: 'No-acid standard curve', required: true },
			],
			grids: [
				{
					key: 'reps',
					title: 'Replicates',
					columns: [
						{ key: 'fluor_before', label: 'Fluor 1', required: true },
						{ key: 'fluor_after', label: 'Fluor 2' },
						{ key: 'vol_total_ml', label: 'Vol total', unit: 'mL', required: true },
						{ key: 'vol_after_ml', label: 'Vol after', unit: 'mL', required: true },
						{ key: 'd1', label: 'Rock d1', unit: 'cm' },
						{ key: 'd2', label: 'Rock d2', unit: 'cm' },
						{ key: 'd3', label: 'Rock d3', unit: 'cm' },
						{ key: 'wgt_dried_g', label: 'Filter dried', unit: 'g' },
						{ key: 'wgt_ashed_g', label: 'Filter ashed', unit: 'g' },
					],
					defaultRows: 5,
					rowLabel: letter,
					derived: [
						{
							label: 'Vol filtrated (mL)',
							compute: (row) => {
								const t = num(row['vol_total_ml']);
								const a = num(row['vol_after_ml']);
								return t !== null && a !== null ? t - a : null;
							},
						},
						{
							label: 'AFDM (g)',
							compute: (row) => {
								const d = num(row['wgt_dried_g']);
								const s = num(row['wgt_ashed_g']);
								return d !== null && s !== null ? d - s : null;
							},
						},
					],
				},
			],
			buildPayload: ({ grids, curves }) => {
				const acid = curvePair(curves['acid']);
				const noacid = curvePair(curves['noacid']);
				if (!acid || !noacid) return { error: 'Select or enter both standard curves' };
				const replicates = [];
				for (const [i, row] of grids['reps'].entries()) {
					if (Object.values(row).every((v) => v === '')) continue;
					const fluorBefore = num(row['fluor_before']);
					const volTotal = num(row['vol_total_ml']);
					const volAfter = num(row['vol_after_ml']);
					if (fluorBefore === null || volTotal === null || volAfter === null) {
						return { error: `Replicate ${letter(i)} needs Fluor 1, Vol total and Vol after` };
					}
					const dried = num(row['wgt_dried_g']);
					const ashed = num(row['wgt_ashed_g']);
					replicates.push({
						fluor_before: fluorBefore,
						fluor_after: num(row['fluor_after']),
						vol_total_ml: volTotal,
						vol_after_ml: volAfter,
						diameters_cm: [row['d1'], row['d2'], row['d3']]
							.map(num)
							.filter((n): n is number => n !== null),
						afdm_g_filter: dried !== null && ashed !== null ? dried - ashed : null,
					});
				}
				if (replicates.length === 0) return { error: 'Enter at least one replicate' };
				return {
					payload: {
						acid_slope: acid.slope,
						acid_intercept: acid.intercept,
						noacid_slope: noacid.slope,
						noacid_intercept: noacid.intercept,
						replicates,
					},
				};
			},
		},
		{
			name: 'field_data',
			title: 'Field Data',
			description: 'Vaisala CO₂ min/avg/max correction, BP with altitude fallback, reach depths',
			domain: 'Hydrology',
			scalars: [
				{ key: 'elevation_m', label: 'Elevation', unit: 'm' },
				{ key: 'temp_c', label: 'Water temperature', unit: '°C' },
				{
					key: 'field_bp',
					label: 'Field barometric pressure',
					unit: 'hPa',
					help: 'Used when within 700-1050 hPa; otherwise the altitude-derived BP applies',
				},
				{ key: 'raw_co2_min', label: 'Vaisala CO₂ min', unit: 'ppm' },
				{ key: 'raw_co2_avg', label: 'Vaisala CO₂ avg', unit: 'ppm' },
				{ key: 'raw_co2_max', label: 'Vaisala CO₂ max', unit: 'ppm' },
			],
			curves: [{ key: 'std_curve', title: 'Vaisala CO₂ standard curve' }],
			grids: [
				{
					key: 'reach_depths',
					title: 'Reach depths',
					columns: [{ key: 'value', label: 'Depth', unit: 'cm' }],
					defaultRows: 10,
					maxRows: 10,
					rowLabel: (i) => `${i + 1}`,
				},
			],
			buildPayload: ({ scalars, grids, curves }) => {
				const built = scalarPayload(
					[
						{ key: 'elevation_m', label: 'Elevation' },
						{ key: 'temp_c', label: 'Water temperature' },
						{ key: 'field_bp', label: 'Field barometric pressure' },
						{ key: 'raw_co2_min', label: 'Vaisala CO₂ min' },
						{ key: 'raw_co2_avg', label: 'Vaisala CO₂ avg' },
						{ key: 'raw_co2_max', label: 'Vaisala CO₂ max' },
					],
					scalars,
				);
				if ('error' in built) return built;
				const payload = { ...built.payload };
				const depths = grids['reach_depths']
					.map((r) => num(r['value']))
					.filter((n): n is number => n !== null);
				if (depths.length > 0) payload.reach_depths = depths;
				const c = curvePair(curves['std_curve']);
				if (c) payload.std_curve = c;
				if (Object.keys(payload).length === 0) return { error: 'Enter at least one value' };
				return { payload };
			},
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
	let scalarValues = $state<Record<string, string>>({});
	let gridRows = $state<Record<string, Record<string, string>[]>>({});
	let curveSelections = $state<Record<string, CurveSelection>>({});
	let result = $state<Record<string, unknown> | null>(null);
	let resultCurveLabel = $state('');
	let calculating = $state(false);
	let showSaveDialog = $state(false);

	function emptyRow(grid: GridDef): Record<string, string> {
		return Object.fromEntries(grid.columns.map((c) => [c.key, '']));
	}

	function selectTool(tool: Tool) {
		activeTool = tool;
		result = null;
		const sv: Record<string, string> = {};
		for (const inp of tool.scalars ?? []) {
			sv[inp.key] = inp.type === 'select' && inp.options?.length ? inp.options[0].value : '';
		}
		scalarValues = sv;
		const gr: Record<string, Record<string, string>[]> = {};
		for (const grid of tool.grids ?? []) {
			gr[grid.key] = Array.from({ length: grid.defaultRows }, () => emptyRow(grid));
		}
		gridRows = gr;
		const cs: Record<string, CurveSelection> = {};
		for (const c of tool.curves ?? []) cs[c.key] = emptyCurveSelection();
		curveSelections = cs;
	}

	function addGridRow(grid: GridDef) {
		if (grid.maxRows && (gridRows[grid.key]?.length ?? 0) >= grid.maxRows) return;
		gridRows[grid.key] = [...(gridRows[grid.key] ?? []), emptyRow(grid)];
	}

	function removeGridRow(grid: GridDef, idx: number) {
		gridRows[grid.key] = (gridRows[grid.key] ?? []).filter((_, i) => i !== idx);
	}

	// Provenance note for the save step: stored curves carry their standard-curve id.
	const curveNote = $derived.by(() => {
		if (!activeTool) return '';
		return (activeTool.curves ?? [])
			.map((c) => {
				const sel = curveSelections[c.key];
				return sel?.standardCurveId ? `${c.title}: ${sel.label} [${sel.standardCurveId}]` : null;
			})
			.filter((p): p is string => p !== null)
			.join('; ');
	});

	// Curves declared by a tool are applied to the numbers during the calculation, so the save step
	// records them as text and must not send a curve reference for the API to apply again.
	const currentCurveLabel = $derived.by(() => {
		if (!activeTool) return '';
		return (activeTool.curves ?? [])
			.map((c) => {
				const sel = curveSelections[c.key];
				return sel?.slope != null && sel.intercept != null ? (sel.label ?? c.title) : null;
			})
			.filter((p): p is string => p !== null)
			.join('; ');
	});

	async function calculate() {
		if (!activeTool) return;
		const built = activeTool.buildPayload({ scalars: scalarValues, grids: gridRows, curves: curveSelections });
		if ('error' in built) {
			toastStore.error(built.error);
			return;
		}
		calculating = true;
		result = null;
		resultCurveLabel = '';
		try {
			const res = await POST<{ results: Record<string, unknown> }>(
				`/api/tools/${activeTool.name}/calculate`,
				built.payload,
			);
			result = res.results;
			// The curves these numbers were computed with, not whatever the pickers hold later.
			resultCurveLabel = currentCurveLabel;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Calculation failed');
		} finally {
			calculating = false;
		}
	}
</script>

<svelte:head><title>Tools | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Analytical Tools</h2>
		{#if activeTool}
			<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => { activeTool = null; result = null; }}>&larr; All Tools</Button>
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
		<div class="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6">
			<div class="space-y-4">
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
					<h3 class="text-base font-semibold mb-1">{activeTool.title}</h3>
					<p class="text-sm text-brand-muted mb-4">{activeTool.description}</p>

					<form onsubmit={(e) => { e.preventDefault(); calculate(); }} class="space-y-3">
						{#each activeTool.scalars ?? [] as inp}
							<div class="flex flex-col gap-1">
								<label for={inp.key} class="text-sm font-medium">
									{inp.label}
									{#if inp.unit}<span class="text-brand-muted font-normal">({inp.unit})</span>{/if}
									{#if inp.required}<span class="text-severity-alarm">*</span>{/if}
								</label>
								{#if inp.type === 'select'}
									<select
										id={inp.key}
										bind:value={scalarValues[inp.key]}
										class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
									>
										{#each inp.options ?? [] as opt}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								{:else}
									<input
										id={inp.key}
										type="number"
										step="any"
										bind:value={scalarValues[inp.key]}
										class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
									/>
								{/if}
								{#if inp.help}
									<p class="text-xs text-brand-muted">{inp.help}</p>
								{/if}
							</div>
						{/each}

						{#each activeTool.grids ?? [] as grid}
							<div>
								<span class="text-sm font-medium">{grid.title}</span>
								<div class="overflow-x-auto mt-1">
									<table class="text-xs w-full">
										<thead>
											<tr class="text-left text-brand-muted">
												<th class="px-1 py-1"></th>
												{#each grid.columns as col}
													<th class="px-1 py-1 whitespace-nowrap">
														{col.label}{#if col.unit}&nbsp;({col.unit}){/if}{#if col.required}<span class="text-severity-alarm">*</span>{/if}
													</th>
												{/each}
												{#each grid.derived ?? [] as d}
													<th class="px-1 py-1 whitespace-nowrap italic">{d.label}</th>
												{/each}
												{#if !grid.fixedRows}<th class="px-1 py-1"></th>{/if}
											</tr>
										</thead>
										<tbody>
											{#each gridRows[grid.key] ?? [] as row, idx}
												<tr>
													<td class="px-1 py-0.5 text-brand-muted font-medium">{grid.rowLabel(idx)}</td>
													{#each grid.columns as col}
														<td class="px-1 py-0.5">
															<input
																type="number"
																step="any"
																bind:value={gridRows[grid.key][idx][col.key]}
																aria-label="{grid.title} {grid.rowLabel(idx)} {col.label}"
																class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
															/>
														</td>
													{/each}
													{#each grid.derived ?? [] as d}
														{@const dv = d.compute(row)}
														<td class="px-1 py-0.5 font-mono text-brand-muted">
															{dv !== null ? (Number.isInteger(dv) ? dv : dv.toPrecision(5)) : ''}
														</td>
													{/each}
													{#if !grid.fixedRows}
														<td class="px-1 py-0.5">
															{#if (gridRows[grid.key]?.length ?? 0) > 1}
																<button type="button" onclick={() => removeGridRow(grid, idx)} aria-label="Remove row" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
															{/if}
														</td>
													{/if}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if !grid.fixedRows && (!grid.maxRows || (gridRows[grid.key]?.length ?? 0) < grid.maxRows)}
									<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addGridRow(grid)}>+ Add row</Button>
								{/if}
							</div>
						{/each}

						{#each activeTool.curves ?? [] as c (activeTool.name + c.key)}
							<CurvePicker title={c.title} required={c.required} bind:value={curveSelections[c.key]} />
						{/each}

						<Button variant="primary" type="submit" disabled={calculating}>
							{calculating ? 'Calculating…' : 'Calculate'}
						</Button>
					</form>
				</div>
			</div>

			<div>
				{#if result}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
						<div class="flex items-center justify-between mb-3">
							<h3 class="text-sm font-semibold">Results</h3>
							<Button
								variant="primary"
								size="sm"
								onclick={() => (showSaveDialog = true)}
							>Save to Site</Button>
						</div>
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

<SaveResultsPanel bind:open={showSaveDialog} toolTitle={activeTool?.title ?? ''} results={result} {curveNote} appliedCurveLabel={resultCurveLabel} />
