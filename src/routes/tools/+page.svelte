<script lang="ts">
	import { page } from '$app/state';
	import {
		listTools,
		calculateTool,
		type ToolDescriptor,
		type ToolParam,
		type ToolCalculateResponse,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import CurvePicker, {
		emptyCurveSelection,
		type CurveSelection,
	} from '$components/tools/CurvePicker.svelte';
	import SaveResultsPanel, { type UsedCurve } from '$components/tools/SaveResultsPanel.svelte';

	const letter = (i: number) => String.fromCharCode(65 + i);
	const num = (s: string | undefined): number | null =>
		s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;

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

	// Bespoke entry grid for one structured param (object / replicate_grid) that the generic
	// renderer would otherwise show as a JSON textarea.
	interface GridSpec {
		title: string;
		columns: GridColumn[];
		defaultRows: number;
		fixedRows?: boolean;
		maxRows?: number;
		rowLabel: (i: number) => string;
		derived?: DerivedColumn[];
		/** Payload value for the param; null omits it, string is a validation error. */
		build: (rows: Record<string, string>[]) => unknown | null | { error: string };
		/** Rows from a prefilled payload value, for "Reload into tool". */
		restore?: (value: unknown) => Record<string, string>[] | null;
	}

	// Several kind=array params entered as columns of one grid (paired series).
	interface ArrayGroup {
		title: string;
		params: string[];
		defaultRows: number;
	}

	// A curve picker that fills two plain number params (tools whose manifest takes slope/intercept
	// directly rather than a curve slot).
	interface CurveParamSpec {
		title: string;
		slope: string;
		intercept: string;
		required?: boolean;
	}

	interface ToolOverride {
		domain?: string;
		grids?: Record<string, GridSpec>;
		arrayGroups?: ArrayGroup[];
		arrayDefaultRows?: Record<string, number>;
		curveParams?: CurveParamSpec[];
	}

	function objectFromRow(
		row: Record<string, string>,
		requiredKeys: string[],
		label: string,
	): Record<string, number> | null | { error: string } {
		if (Object.values(row).every((v) => v === '')) return null;
		const out: Record<string, number> = {};
		for (const [k, v] of Object.entries(row)) {
			const n = num(v);
			if (n !== null) out[k] = n;
		}
		for (const k of requiredKeys) {
			if (out[k] === undefined) return { error: `${label} is incomplete (or clear it)` };
		}
		return out;
	}

	function rowFromObject(value: unknown, keys: string[]): Record<string, string>[] | null {
		if (typeof value !== 'object' || value === null) return null;
		const obj = value as Record<string, unknown>;
		return [
			Object.fromEntries(keys.map((k) => [k, typeof obj[k] === 'number' ? String(obj[k]) : ''])),
		];
	}

	const DIC_REP_COLUMNS: GridColumn[] = [
		{ key: 'acid_sample_weight_g', label: 'Acid+sample wgt', unit: 'g', required: true },
		{ key: 'acid_weight_g', label: 'Acid wgt', unit: 'g', required: true },
		{ key: 'vol_overpressure_ml', label: 'Vol overpressure', unit: 'mL', required: true },
		{ key: 'sa_added_ml', label: 'SA added', unit: 'mL', required: true },
		{ key: 'co2_dry_ppm', label: 'CO2 dry', unit: 'ppm', required: true },
		{ key: 'd13co2_permil', label: 'd13CO2', unit: 'permil' },
	];
	const DIC_REP_REQUIRED = DIC_REP_COLUMNS.filter((c) => c.required).map((c) => c.key);

	const PCO2_REP_COLUMNS: GridColumn[] = [
		{ key: 'co2_ppm', label: 'CO2', unit: 'ppm', required: true },
		{ key: 'h2o_percent', label: 'H2O', unit: '%', required: true },
		{ key: 'ch4_ppm', label: 'CH4', unit: 'ppm', required: true },
		{ key: 'd13co2_permil', label: 'd13CO2', unit: 'permil' },
	];
	const PCO2_REP_REQUIRED = PCO2_REP_COLUMNS.filter((c) => c.required).map((c) => c.key);

	// Species keys as the API expects them. SRP keeps the legacy SRP_*_ugL series; current NH4
	// entry goes to NUT_NH4_*.
	const NUTRIENT_SPECIES = ['P', 'NUT_NH4', 'SRP', 'NOx', 'NO2', 'TDP', 'TDN'];
	const NUTRIENT_LABELS = ['P', 'NH4', 'SRP', 'NOx', 'NO2', 'TDP', 'TDN'];

	const DOMAINS: Record<string, string> = {
		doc: 'Carbon',
		dic: 'Carbon',
		pco2: 'Carbon',
		co2_air: 'Carbon',
		dom: 'Carbon',
		alkalinity: 'Ions',
		nutrients: 'Nutrients',
		tss_afdm: 'Suspended',
		benthic: 'Suspended',
		chlorophyll: 'Field',
		chla_benthic: 'Field',
		field_data: 'Hydrology',
		discharge: 'Hydrology',
	};

	const overrides: Record<string, ToolOverride> = {
		dic: {
			grids: {
				replicate_b: {
					title: 'Replicate B (optional)',
					columns: DIC_REP_COLUMNS,
					defaultRows: 1,
					fixedRows: true,
					rowLabel: () => 'B',
					build: (rows) => objectFromRow(rows[0] ?? {}, DIC_REP_REQUIRED, 'Replicate B'),
					restore: (v) => rowFromObject(v, DIC_REP_COLUMNS.map((c) => c.key)),
				},
			},
		},
		pco2: {
			grids: {
				replicate_b: {
					title: 'Replicate B (optional, full pipeline)',
					columns: PCO2_REP_COLUMNS,
					defaultRows: 1,
					fixedRows: true,
					rowLabel: () => 'B',
					build: (rows) => objectFromRow(rows[0] ?? {}, PCO2_REP_REQUIRED, 'Replicate B'),
					restore: (v) => rowFromObject(v, PCO2_REP_COLUMNS.map((c) => c.key)),
				},
			},
		},
		nutrients: {
			grids: {
				species: {
					title: 'Species replicates (ug/L)',
					columns: [
						{ key: 'a', label: 'Rep A' },
						{ key: 'b', label: 'Rep B' },
						{ key: 'c', label: 'Rep C' },
					],
					defaultRows: NUTRIENT_SPECIES.length,
					fixedRows: true,
					rowLabel: (i) => NUTRIENT_LABELS[i],
					build: (rows) => {
						const species: Record<string, number[]> = {};
						rows.forEach((row, i) => {
							const reps = [row['a'], row['b'], row['c']]
								.map(num)
								.filter((n): n is number => n !== null);
							if (reps.length > 0) species[NUTRIENT_SPECIES[i]] = reps;
						});
						if (Object.keys(species).length === 0)
							return { error: 'Enter at least one replicate' };
						return species;
					},
					restore: (v) => {
						if (typeof v !== 'object' || v === null) return null;
						const map = v as Record<string, unknown>;
						return NUTRIENT_SPECIES.map((sp) => {
							const reps = Array.isArray(map[sp]) ? (map[sp] as unknown[]) : [];
							return {
								a: typeof reps[0] === 'number' ? String(reps[0]) : '',
								b: typeof reps[1] === 'number' ? String(reps[1]) : '',
								c: typeof reps[2] === 'number' ? String(reps[2]) : '',
							};
						});
					},
				},
			},
		},
		chla_benthic: {
			grids: {
				replicates: {
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
					build: (rows) => {
						const replicates = [];
						for (const [i, row] of rows.entries()) {
							if (Object.values(row).every((v) => v === '')) continue;
							const fluorBefore = num(row['fluor_before']);
							const volTotal = num(row['vol_total_ml']);
							const volAfter = num(row['vol_after_ml']);
							if (fluorBefore === null || volTotal === null || volAfter === null) {
								return {
									error: `Replicate ${letter(i)} needs Fluor 1, Vol total and Vol after`,
								};
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
						return replicates;
					},
					restore: (v) => {
						if (!Array.isArray(v)) return null;
						return v.map((rep) => {
							const r = (rep ?? {}) as Record<string, unknown>;
							const d = Array.isArray(r.diameters_cm) ? (r.diameters_cm as unknown[]) : [];
							const s = (x: unknown) => (typeof x === 'number' ? String(x) : '');
							// Filter weights are not in the payload (only their AFDM difference), so
							// they come back blank.
							return {
								fluor_before: s(r.fluor_before),
								fluor_after: s(r.fluor_after),
								vol_total_ml: s(r.vol_total_ml),
								vol_after_ml: s(r.vol_after_ml),
								d1: s(d[0]),
								d2: s(d[1]),
								d3: s(d[2]),
								wgt_dried_g: '',
								wgt_ashed_g: '',
							};
						});
					},
				},
			},
		},
		chlorophyll: {
			curveParams: [
				{ title: 'Standard curve', slope: 'slope', intercept: 'intercept', required: true },
			],
		},
		discharge: {
			arrayGroups: [{ title: 'Tracer series', params: ['times_s', 'values'], defaultRows: 10 }],
		},
		field_data: {
			arrayDefaultRows: { reach_depths: 10 },
		},
	};

	const domainColors: Record<string, string> = {
		Hydrology: 'border-viz-0/50 bg-viz-0/5',
		Carbon: 'border-viz-1/50 bg-viz-1/5',
		Nutrients: 'border-viz-2/50 bg-viz-2/5',
		Suspended: 'border-viz-3/50 bg-viz-3/5',
		Ions: 'border-viz-5/50 bg-viz-5/5',
		Field: 'border-viz-4/50 bg-viz-4/5',
	};

	let tools = $state<ToolDescriptor[]>([]);
	let loadError = $state('');
	let loading = $state(true);

	let activeTool = $state<ToolDescriptor | null>(null);
	let values = $state<Record<string, string>>({});
	let boolValues = $state<Record<string, boolean>>({});
	let arrayRows = $state<Record<string, string[]>>({});
	let gridRows = $state<Record<string, Record<string, string>[]>>({});
	let groupRows = $state<Record<string, Record<string, string>[]>>({});
	let jsonValues = $state<Record<string, string>>({});
	let curveSelections = $state<Record<string, CurveSelection>>({});
	let curveParamSelections = $state<Record<string, CurveSelection>>({});
	let result = $state<ToolCalculateResponse | null>(null);
	let resultInputs = $state<Record<string, unknown> | null>(null);
	let resultCurves = $state<UsedCurve[]>([]);
	let calculating = $state(false);
	let showSaveDialog = $state(false);

	const domains = $derived([
		...new Set(tools.map((t) => overrides[t.name]?.domain ?? DOMAINS[t.name] ?? 'Other')),
	]);
	const domainOf = (t: ToolDescriptor) => overrides[t.name]?.domain ?? DOMAINS[t.name] ?? 'Other';

	const override = $derived(activeTool ? (overrides[activeTool.name] ?? {}) : {});

	function enumVariants(kind: string): string[] {
		return kind.startsWith('enum:') ? kind.slice(5).split('|') : [];
	}

	// Render plan: manifest order, with structured params swapped for their bespoke widgets and
	// curve-backed number pairs collapsed into a picker.
	type RenderItem =
		| { type: 'scalar'; param: ToolParam }
		| { type: 'array'; param: ToolParam }
		| { type: 'grid'; param: ToolParam; spec: GridSpec }
		| { type: 'group'; group: ArrayGroup; params: ToolParam[] }
		| { type: 'json'; param: ToolParam }
		| { type: 'curveParam'; spec: CurveParamSpec };

	const renderItems = $derived.by((): RenderItem[] => {
		if (!activeTool) return [];
		const o = override;
		const items: RenderItem[] = [];
		const groupEmitted = new Set<string>();
		const cpBySlope = new Map((o.curveParams ?? []).map((cp) => [cp.slope, cp]));
		const cpIntercepts = new Set((o.curveParams ?? []).map((cp) => cp.intercept));
		for (const p of activeTool.params) {
			const spec = o.grids?.[p.name];
			if (spec) {
				items.push({ type: 'grid', param: p, spec });
				continue;
			}
			const group = o.arrayGroups?.find((g) => g.params.includes(p.name));
			if (group) {
				if (!groupEmitted.has(group.title)) {
					groupEmitted.add(group.title);
					items.push({
						type: 'group',
						group,
						params: group.params.map(
							(name) => activeTool!.params.find((q) => q.name === name) ?? p,
						),
					});
				}
				continue;
			}
			const cp = cpBySlope.get(p.name);
			if (cp) {
				items.push({ type: 'curveParam', spec: cp });
				continue;
			}
			if (cpIntercepts.has(p.name)) continue;
			if (p.kind === 'array') items.push({ type: 'array', param: p });
			else if (p.kind === 'object' || p.kind === 'replicate_grid')
				items.push({ type: 'json', param: p });
			else items.push({ type: 'scalar', param: p });
		}
		return items;
	});

	function selectTool(tool: ToolDescriptor, prefill?: Record<string, unknown>) {
		activeTool = tool;
		result = null;
		resultInputs = null;
		resultCurves = [];
		const o = overrides[tool.name] ?? {};
		const v: Record<string, string> = {};
		const b: Record<string, boolean> = {};
		const ar: Record<string, string[]> = {};
		const gr: Record<string, Record<string, string>[]> = {};
		const grp: Record<string, Record<string, string>[]> = {};
		const js: Record<string, string> = {};
		for (const p of tool.params) {
			const spec = o.grids?.[p.name];
			if (spec) {
				const restored =
					prefill && spec.restore ? spec.restore(prefill[p.name]) : null;
				gr[p.name] =
					restored ??
					Array.from({ length: spec.defaultRows }, () =>
						Object.fromEntries(spec.columns.map((c) => [c.key, ''])),
					);
				continue;
			}
			if (o.arrayGroups?.some((g) => g.params.includes(p.name))) continue;
			if (p.kind === 'boolean') {
				b[p.name] =
					typeof prefill?.[p.name] === 'boolean'
						? (prefill[p.name] as boolean)
						: p.default === true;
				continue;
			}
			if (p.kind === 'array') {
				const pre = Array.isArray(prefill?.[p.name]) ? (prefill![p.name] as unknown[]) : null;
				const n = o.arrayDefaultRows?.[p.name] ?? 3;
				ar[p.name] = pre
					? pre.map((x) => (typeof x === 'number' ? String(x) : ''))
					: Array.from({ length: n }, () => '');
				continue;
			}
			if (p.kind === 'object' || p.kind === 'replicate_grid') {
				js[p.name] =
					prefill?.[p.name] !== undefined ? JSON.stringify(prefill[p.name], null, 2) : '';
				continue;
			}
			const pre = prefill?.[p.name];
			if (pre !== undefined && pre !== null) v[p.name] = String(pre);
			else if (p.default !== null && p.default !== undefined) v[p.name] = String(p.default);
			else if (p.required && enumVariants(p.kind).length > 0) v[p.name] = enumVariants(p.kind)[0];
			else v[p.name] = '';
		}
		for (const g of o.arrayGroups ?? []) {
			const lists = g.params.map((name) =>
				Array.isArray(prefill?.[name]) ? (prefill![name] as unknown[]) : null,
			);
			const len = Math.max(g.defaultRows, ...lists.map((l) => l?.length ?? 0));
			grp[g.title] = Array.from({ length: len }, (_, i) =>
				Object.fromEntries(
					g.params.map((name, pi) => {
						const x = lists[pi]?.[i];
						return [name, typeof x === 'number' ? String(x) : ''];
					}),
				),
			);
		}
		values = v;
		boolValues = b;
		arrayRows = ar;
		gridRows = gr;
		groupRows = grp;
		jsonValues = js;
		const cs: Record<string, CurveSelection> = {};
		for (const c of tool.curves) {
			cs[c.name] = curveFromPrefill(prefill?.[c.name]) ?? emptyCurveSelection();
		}
		curveSelections = cs;
		const cps: Record<string, CurveSelection> = {};
		for (const cp of o.curveParams ?? []) {
			const slope = prefill?.[cp.slope];
			const intercept = prefill?.[cp.intercept];
			cps[cp.title] =
				typeof slope === 'number' && typeof intercept === 'number'
					? { standardCurveId: null, slope, intercept, label: null }
					: emptyCurveSelection();
		}
		curveParamSelections = cps;
	}

	function curveFromPrefill(v: unknown): CurveSelection | null {
		if (typeof v !== 'object' || v === null) return null;
		const o = v as Record<string, unknown>;
		return {
			standardCurveId: typeof o.standard_curve_id === 'string' ? o.standard_curve_id : null,
			slope: typeof o.slope === 'number' ? o.slope : null,
			intercept: typeof o.intercept === 'number' ? o.intercept : null,
			label: typeof o.label === 'string' ? o.label : null,
		};
	}

	function addArrayRow(name: string) {
		arrayRows[name] = [...(arrayRows[name] ?? []), ''];
	}
	function removeArrayRow(name: string, idx: number) {
		arrayRows[name] = (arrayRows[name] ?? []).filter((_, i) => i !== idx);
	}
	function addGridRow(name: string, spec: GridSpec) {
		if (spec.maxRows && (gridRows[name]?.length ?? 0) >= spec.maxRows) return;
		gridRows[name] = [
			...(gridRows[name] ?? []),
			Object.fromEntries(spec.columns.map((c) => [c.key, ''])),
		];
	}
	function removeGridRow(name: string, idx: number) {
		gridRows[name] = (gridRows[name] ?? []).filter((_, i) => i !== idx);
	}
	function addGroupRow(g: ArrayGroup) {
		groupRows[g.title] = [
			...(groupRows[g.title] ?? []),
			Object.fromEntries(g.params.map((p) => [p, ''])),
		];
	}
	function removeGroupRow(g: ArrayGroup, idx: number) {
		groupRows[g.title] = (groupRows[g.title] ?? []).filter((_, i) => i !== idx);
	}

	type Built = { payload: Record<string, unknown> } | { error: string };

	function buildPayload(): Built {
		if (!activeTool) return { error: 'No tool selected' };
		const o = override;
		const payload: Record<string, unknown> = {};
		for (const p of activeTool.params) {
			const spec = o.grids?.[p.name];
			if (spec) {
				const built = spec.build(gridRows[p.name] ?? []);
				if (built && typeof built === 'object' && 'error' in built) {
					const msg = (built as { error?: unknown }).error;
					if (typeof msg === 'string') return { error: msg };
				}
				if (built !== null) payload[p.name] = built;
				else if (p.required && p.when === null) return { error: `${p.label} is required` };
				continue;
			}
			if (o.arrayGroups?.some((g) => g.params.includes(p.name))) continue;
			if (o.curveParams?.some((cp) => cp.slope === p.name || cp.intercept === p.name)) continue;
			if (p.kind === 'boolean') {
				payload[p.name] = boolValues[p.name] ?? false;
				continue;
			}
			if (p.kind === 'array') {
				const nums = (arrayRows[p.name] ?? [])
					.map((s) => num(s))
					.filter((n): n is number => n !== null);
				if (nums.length > 0) payload[p.name] = nums;
				else if (p.required && p.when === null)
					return { error: `${p.label} needs at least one value` };
				continue;
			}
			if (p.kind === 'object' || p.kind === 'replicate_grid') {
				const raw = (jsonValues[p.name] ?? '').trim();
				if (!raw) {
					if (p.required && p.when === null) return { error: `${p.label} is required` };
					continue;
				}
				try {
					payload[p.name] = JSON.parse(raw);
				} catch {
					return { error: `${p.label}: invalid JSON` };
				}
				continue;
			}
			const raw = (values[p.name] ?? '').trim();
			if (!raw) {
				if (p.required && p.when === null) return { error: `${p.label} is required` };
				continue;
			}
			if (p.kind === 'string' || enumVariants(p.kind).length > 0) {
				payload[p.name] = raw;
				continue;
			}
			if (p.kind === 'integer') {
				const n = Number(raw);
				if (!Number.isInteger(n)) return { error: `${p.label} must be an integer` };
				payload[p.name] = n;
				continue;
			}
			const n = num(raw);
			if (n === null) return { error: `${p.label} must be a number` };
			payload[p.name] = n;
		}
		for (const cp of o.curveParams ?? []) {
			const sel = curveParamSelections[cp.title];
			if (sel && sel.slope !== null && sel.intercept !== null) {
				payload[cp.slope] = sel.slope;
				payload[cp.intercept] = sel.intercept;
			} else if (cp.required) {
				return { error: `Select or enter the ${cp.title.toLowerCase()}` };
			}
		}
		for (const slot of activeTool.curves) {
			const sel = curveSelections[slot.name];
			if (sel?.standardCurveId) {
				payload[slot.name] = { standard_curve_id: sel.standardCurveId };
			} else if (sel && sel.slope !== null && sel.intercept !== null) {
				payload[slot.name] = {
					slope: sel.slope,
					intercept: sel.intercept,
					...(sel.label ? { label: sel.label } : {}),
				};
			} else if (slot.required) {
				return { error: `Select or enter the ${slot.label.toLowerCase()}` };
			}
		}
		if (Object.keys(payload).length === 0) return { error: 'Enter at least one value' };
		return { payload };
	}

	// Every curve consumed by the current inputs, for the provenance blob and the save-step note.
	function usedCurves(): UsedCurve[] {
		if (!activeTool) return [];
		const out: UsedCurve[] = [];
		for (const slot of activeTool.curves) {
			const sel = curveSelections[slot.name];
			if (sel && (sel.standardCurveId || (sel.slope !== null && sel.intercept !== null))) {
				out.push({
					name: slot.name,
					slope: sel.slope,
					intercept: sel.intercept,
					label: sel.label,
					standard_curve_id: sel.standardCurveId,
				});
			}
		}
		for (const cp of override.curveParams ?? []) {
			const sel = curveParamSelections[cp.title];
			if (sel && sel.slope !== null && sel.intercept !== null) {
				out.push({
					name: cp.title,
					slope: sel.slope,
					intercept: sel.intercept,
					label: sel.label,
					standard_curve_id: sel.standardCurveId,
				});
			}
		}
		return out;
	}

	async function calculate() {
		if (!activeTool) return;
		const built = buildPayload();
		if ('error' in built) {
			toastStore.error(built.error);
			return;
		}
		calculating = true;
		result = null;
		try {
			const res = await calculateTool(activeTool.name, built.payload);
			result = res;
			// Snapshots taken now: the provenance records what these numbers were computed with,
			// not whatever the form holds later.
			resultInputs = built.payload;
			resultCurves = usedCurves();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Calculation failed');
		} finally {
			calculating = false;
		}
	}

	// The save step must not send a curve reference for a correction the calculation already
	// applied, so it shows the applied curves read-only instead.
	const appliedCurveLabel = $derived(
		resultCurves
			.map((c) =>
				c.label ?? (c.slope !== null && c.intercept !== null ? `${c.name} (manual)` : c.name),
			)
			.join('; '),
	);

	const displayResults = $derived(
		result ? Object.entries(result.results).filter(([, v]) => v != null) : [],
	);

	$effect(() => {
		listTools()
			.then((t) => {
				tools = t;
				applyPrefill(t);
			})
			.catch((e) => (loadError = e instanceof Error ? e.message : 'Failed to load tools'))
			.finally(() => (loading = false));
	});

	// ?tool= names the tool; a "Reload into tool" navigation stashes the inputs in sessionStorage.
	function applyPrefill(loaded: ToolDescriptor[]) {
		const wanted = page.url.searchParams.get('tool');
		if (!wanted) return;
		const tool = loaded.find((t) => t.name === wanted);
		if (!tool) return;
		let inputs: Record<string, unknown> | undefined;
		if (page.url.searchParams.get('prefill') === 'session') {
			try {
				const raw = sessionStorage.getItem('tool-prefill');
				if (raw) {
					const blob = JSON.parse(raw) as { tool?: string; inputs?: Record<string, unknown> };
					if (blob.tool === wanted && blob.inputs && typeof blob.inputs === 'object') {
						inputs = blob.inputs;
					}
				}
			} catch {
				inputs = undefined;
			}
			sessionStorage.removeItem('tool-prefill');
		}
		selectTool(tool, inputs);
	}

	function fmtValue(value: unknown): string {
		if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toPrecision(6);
		if (Array.isArray(value)) return value.map(fmtValue).join(', ');
		return String(value);
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

	{#if loadError}
		<ErrorNotice message={loadError} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading tools…</p>
	{:else if !activeTool}
		{#each domains as domain}
			<div>
				<h3 class="text-sm font-semibold text-brand-muted uppercase tracking-wider mb-2">{domain}</h3>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{#each tools.filter((t) => domainOf(t) === domain) as tool (tool.name)}
						<button
							onclick={() => selectTool(tool)}
							class="text-left p-4 rounded-md border {domainColors[domain] ?? 'border-brand-divider bg-brand-surface'} cursor-pointer hover:shadow-sm transition-shadow"
						>
							<div class="font-semibold text-sm">{tool.label}</div>
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
					<div class="flex items-baseline justify-between mb-1">
						<h3 class="text-base font-semibold">{activeTool.label}</h3>
						<span class="text-xs text-brand-muted">v{activeTool.version_no}</span>
					</div>
					<p class="text-sm text-brand-muted mb-4">{activeTool.description}</p>

					<form onsubmit={(e) => { e.preventDefault(); calculate(); }} class="space-y-3">
						{#each renderItems as item (item.type === 'curveParam' ? item.spec.title : item.type === 'group' ? item.group.title : item.param.name)}
							{#if item.type === 'scalar'}
								{@const p = item.param}
								<div class="flex flex-col gap-1">
									<label for="tp-{p.name}" class="text-sm font-medium">
										{p.label}
										{#if p.units}<span class="text-brand-muted font-normal">({p.units})</span>{/if}
										{#if p.required && p.when === null}<span class="text-severity-alarm">*</span>{/if}
									</label>
									{#if enumVariants(p.kind).length > 0}
										<select
											id="tp-{p.name}"
											bind:value={values[p.name]}
											class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
										>
											{#if !p.required && p.default == null}<option value=""> - </option>{/if}
											{#each enumVariants(p.kind) as variant}
												<option value={variant}>{variant.replace(/_/g, ' ')}</option>
											{/each}
										</select>
									{:else if p.kind === 'string'}
										<input
											id="tp-{p.name}"
											type="text"
											bind:value={values[p.name]}
											class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
										/>
									{:else}
										<input
											id="tp-{p.name}"
											type="number"
											step={p.kind === 'integer' ? '1' : 'any'}
											bind:value={values[p.name]}
											class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
										/>
									{/if}
									{#if p.when}
										<p class="text-xs text-brand-muted">Applies when: {p.when}</p>
									{/if}
								</div>
							{:else if item.type === 'array'}
								{@const p = item.param}
								<div>
									<span class="text-sm font-medium">
										{p.label}
										{#if p.units}<span class="text-brand-muted font-normal">({p.units})</span>{/if}
										{#if p.required && p.when === null}<span class="text-severity-alarm">*</span>{/if}
									</span>
									{#if p.when}<p class="text-xs text-brand-muted">Applies when: {p.when}</p>{/if}
									<div class="mt-1 space-y-1">
										{#each arrayRows[p.name] ?? [] as _, idx}
											<div class="flex items-center gap-1.5">
												<span class="text-xs text-brand-muted font-medium w-5 text-right">{idx + 1}</span>
												<input
													type="number"
													step="any"
													bind:value={arrayRows[p.name][idx]}
													aria-label="{p.label} {idx + 1}"
													class="w-40 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs"
												/>
												{#if (arrayRows[p.name]?.length ?? 0) > 1}
													<button type="button" onclick={() => removeArrayRow(p.name, idx)} aria-label="Remove value" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
												{/if}
											</div>
										{/each}
									</div>
									<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addArrayRow(p.name)}>+ Add value</Button>
								</div>
							{:else if item.type === 'grid'}
								{@const p = item.param}
								{@const spec = item.spec}
								<div>
									<span class="text-sm font-medium">
										{spec.title}
										{#if p.required && p.when === null}<span class="text-severity-alarm">*</span>{/if}
									</span>
									{#if p.when}<p class="text-xs text-brand-muted">Applies when: {p.when}</p>{/if}
									<div class="overflow-x-auto mt-1">
										<table class="text-xs w-full">
											<thead>
												<tr class="text-left text-brand-muted">
													<th class="px-1 py-1"></th>
													{#each spec.columns as col}
														<th class="px-1 py-1 whitespace-nowrap">
															{col.label}{#if col.unit}&nbsp;({col.unit}){/if}{#if col.required}<span class="text-severity-alarm">*</span>{/if}
														</th>
													{/each}
													{#each spec.derived ?? [] as d}
														<th class="px-1 py-1 whitespace-nowrap italic">{d.label}</th>
													{/each}
													{#if !spec.fixedRows}<th class="px-1 py-1"></th>{/if}
												</tr>
											</thead>
											<tbody>
												{#each gridRows[p.name] ?? [] as row, idx}
													<tr>
														<td class="px-1 py-0.5 text-brand-muted font-medium">{spec.rowLabel(idx)}</td>
														{#each spec.columns as col}
															<td class="px-1 py-0.5">
																<input
																	type="number"
																	step="any"
																	bind:value={gridRows[p.name][idx][col.key]}
																	aria-label="{spec.title} {spec.rowLabel(idx)} {col.label}"
																	class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
																/>
															</td>
														{/each}
														{#each spec.derived ?? [] as d}
															{@const dv = d.compute(row)}
															<td class="px-1 py-0.5 font-mono text-brand-muted">
																{dv !== null ? (Number.isInteger(dv) ? dv : dv.toPrecision(5)) : ''}
															</td>
														{/each}
														{#if !spec.fixedRows}
															<td class="px-1 py-0.5">
																{#if (gridRows[p.name]?.length ?? 0) > 1}
																	<button type="button" onclick={() => removeGridRow(p.name, idx)} aria-label="Remove row" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
																{/if}
															</td>
														{/if}
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
									{#if !spec.fixedRows && (!spec.maxRows || (gridRows[p.name]?.length ?? 0) < spec.maxRows)}
										<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addGridRow(p.name, spec)}>+ Add row</Button>
									{/if}
								</div>
							{:else if item.type === 'group'}
								{@const g = item.group}
								<div>
									<span class="text-sm font-medium">{g.title}</span>
									<div class="overflow-x-auto mt-1">
										<table class="text-xs w-full">
											<thead>
												<tr class="text-left text-brand-muted">
													<th class="px-1 py-1"></th>
													{#each item.params as p}
														<th class="px-1 py-1 whitespace-nowrap">
															{p.label}{#if p.units}&nbsp;({p.units}){/if}{#if p.required && p.when === null}<span class="text-severity-alarm">*</span>{/if}
														</th>
													{/each}
													<th class="px-1 py-1"></th>
												</tr>
											</thead>
											<tbody>
												{#each groupRows[g.title] ?? [] as _, idx}
													<tr>
														<td class="px-1 py-0.5 text-brand-muted font-medium">{idx + 1}</td>
														{#each g.params as name}
															<td class="px-1 py-0.5">
																<input
																	type="number"
																	step="any"
																	bind:value={groupRows[g.title][idx][name]}
																	aria-label="{g.title} {idx + 1} {name}"
																	class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
																/>
															</td>
														{/each}
														<td class="px-1 py-0.5">
															{#if (groupRows[g.title]?.length ?? 0) > 1}
																<button type="button" onclick={() => removeGroupRow(g, idx)} aria-label="Remove row" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
															{/if}
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
									<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addGroupRow(g)}>+ Add row</Button>
								</div>
							{:else if item.type === 'json'}
								{@const p = item.param}
								<div class="flex flex-col gap-1">
									<label for="tp-{p.name}" class="text-sm font-medium">
										{p.label}
										{#if p.required && p.when === null}<span class="text-severity-alarm">*</span>{/if}
										<span class="text-brand-muted font-normal">(JSON)</span>
									</label>
									{#if p.when}<p class="text-xs text-brand-muted">Applies when: {p.when}</p>{/if}
									<textarea
										id="tp-{p.name}"
										rows="4"
										bind:value={jsonValues[p.name]}
										class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
									></textarea>
								</div>
							{:else if item.type === 'curveParam'}
								<CurvePicker title={item.spec.title} required={item.spec.required} bind:value={curveParamSelections[item.spec.title]} />
							{/if}
						{/each}

						{#each activeTool.curves as c (activeTool.name + c.name)}
							<CurvePicker title={c.label} required={c.required} bind:value={curveSelections[c.name]} />
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
						{#if result.inputs_ignored.length > 0}
							<p class="text-xs text-severity-warning-text bg-severity-warning-soft border border-severity-warning-border rounded-md px-2 py-1 mb-2">
								Ignored inputs: {result.inputs_ignored.join(', ')}
							</p>
						{/if}
						<div class="space-y-2">
							{#each displayResults as [key, value]}
								<div class="flex justify-between text-sm border-b border-brand-divider pb-1 last:border-b-0">
									<span class="text-brand-muted">{key.replace(/_/g, ' ')}</span>
									<span class="font-mono">{fmtValue(value)}</span>
								</div>
							{/each}
							{#if displayResults.length === 0}
								<p class="text-sm text-brand-muted">No outputs were computable from these inputs.</p>
							{/if}
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

<SaveResultsPanel
	bind:open={showSaveDialog}
	toolName={activeTool?.name ?? ''}
	toolTitle={activeTool?.label ?? ''}
	results={result?.results ?? null}
	outputs={activeTool?.outputs ?? []}
	toolVersion={result?.tool_version ?? null}
	calcInputs={resultInputs}
	curvesUsed={resultCurves}
	{appliedCurveLabel}
/>
