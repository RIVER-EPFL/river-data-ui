<script lang="ts">
	import type uPlot from 'uplot';
	import UPlotChart from '$lib/components/charts/UPlotChart.svelte';
	import {
		draftRunFormulasAtVisits,
		type FormulaDraftRun,
		type FormulaDraftRunResponse,
		type VisitListRow,
	} from '$api/service';
	import { draftRunBody, type EditableFormula } from '$lib/calculations/editor';
	import { visitSeries } from '$lib/calculations/visitSeries';
	import { seriesColor, spotMarkerColors } from '$lib/charts/legend';
	import { spotMarkersPlugin, spotWhiskerExtent, type SpotSeriesSpec } from '$lib/charts/spotMarkers';
	import { tzDateOption } from '$lib/charts/uPlotTheme';

	let {
		calculationId,
		formulas,
		siteId,
		visits,
		curves = {},
		paused = false,
		onhover,
	}: {
		calculationId: string;
		formulas: EditableFormula[];
		siteId: string;
		/** The site's visits holding every input the set requires. */
		visits: VisitListRow[];
		/** The curve each slot is run with, as the single-visit run sends it. */
		curves?: Record<string, Record<string, unknown> | null>;
		/** The formula being typed does not parse: nothing is asked and the last drawing stays. */
		paused?: boolean;
		/** The visit under the cursor and the set's run there, so the tables above can show it. */
		onhover?: (at: { time: string; run: FormulaDraftRunResponse } | null) => void;
	} = $props();

	/** Visits per request; the route takes more, a page of this many answers quickly. */
	const CHUNK = 200;

	let runs = $state<FormulaDraftRun[]>([]);
	let manifest = $state<FormulaDraftRunResponse['manifest'] | null>(null);
	let loading = $state(false);
	let failure = $state('');
	let token = 0;

	// uPlot draws x ascending, so the visits are run oldest first.
	const ordered = $derived(
		[...visits].sort((a, b) => Date.parse(a.collected_at) - Date.parse(b.collected_at)),
	);
	const times = $derived(ordered.map((v) => Date.parse(v.collected_at) / 1000));

	$effect(() => {
		if (paused) return;
		const bodies = ordered.map((v) =>
			draftRunBody(formulas, { siteId, collectedAt: v.collected_at }, {}, curves),
		);
		const mine = ++token;
		if (bodies.length === 0 || bodies[0].formulas.length === 0) {
			runs = [];
			return;
		}
		const handle = setTimeout(() => void load(mine, bodies), 400);
		return () => clearTimeout(handle);
	});

	async function load(mine: number, bodies: ReturnType<typeof draftRunBody>[]) {
		loading = true;
		failure = '';
		try {
			const answered: FormulaDraftRun[] = [];
			let implied: FormulaDraftRunResponse['manifest'] | null = null;
			for (let i = 0; i < bodies.length; i += CHUNK) {
				const chunk = bodies.slice(i, i + CHUNK);
				const result = await draftRunFormulasAtVisits(calculationId, {
					formulas: chunk[0].formulas,
					constants: chunk[0].constants,
					inputs: chunk.map((b) => b.inputs ?? {}),
				});
				if (mine !== token) return;
				answered.push(...result.runs);
				implied = result.manifest;
			}
			runs = answered;
			manifest = implied;
		} catch (e) {
			if (mine !== token) return;
			runs = [];
			failure = refusal(e);
		} finally {
			if (mine === token) loading = false;
		}
	}

	/** The route answers a refusal as `{"error": "..."}`; its message is what the author reads. */
	function refusal(e: unknown): string {
		if (!(e instanceof Error)) return 'The set was refused';
		try {
			const body = JSON.parse(e.message) as { error?: unknown };
			if (typeof body.error === 'string') return body.error;
		} catch {
			// Not a JSON body.
		}
		return e.message;
	}

	const series = $derived(runs.length === times.length ? visitSeries(times, runs, formulas) : []);
	const drawn = $derived(series.filter((s) => s.values.some((v) => v != null)));

	const data = $derived([times, ...drawn.map((s) => s.values)] as unknown as uPlot.AlignedData);
	const specs = $derived<SpotSeriesSpec[]>(
		drawn.map((s, i) => ({ seriesIdx: i + 1, ...spotMarkerColors(i), stats: s.stats })),
	);

	function yRange(_u: uPlot, min: number | null, max: number | null): [number, number] {
		const extent = spotWhiskerExtent(drawn.flatMap((s) => [...s.stats.values()]));
		const lo = Math.min(min ?? 0, extent?.[0] ?? Infinity);
		const hi = Math.max(max ?? 1, extent?.[1] ?? -Infinity);
		const pad = hi > lo ? (hi - lo) * 0.1 : Math.abs(hi) * 0.1 || 1;
		return [lo - pad, hi + pad];
	}

	const options = $derived.by(
		(): uPlot.Options => ({
			width: 600,
			height: 220,
			...tzDateOption(),
			scales: { x: { time: true }, y: { auto: true, range: yRange } },
			series: [
				{},
				// A step is dashed: a working number the set hands on, not one it publishes.
				...drawn.map((s, i) => ({
					label: s.role === 'input' ? `${s.label} (input)` : s.label,
					stroke: seriesColor(i),
					width: s.role === 'output' ? 1.5 : 1,
					dash: s.role === 'step' ? [4, 4] : undefined,
					spanGaps: true,
					points: { show: false },
				})),
			],
			plugins: [spotMarkersPlugin(() => specs)],
			hooks: {
				setCursor: [
					(u: uPlot) => {
						const idx = u.cursor.idx;
						const at = idx == null ? undefined : ordered[idx];
						const run = idx == null ? undefined : runs[idx];
						onhover?.(at && run && manifest ? { time: at.collected_at, run: { ...run, manifest } } : null);
					},
				],
			},
			legend: { show: true },
		}),
	);
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="flex items-center justify-between gap-3 px-3 py-2 border-b border-brand-divider bg-brand-bg">
		<span class="text-xs font-semibold text-brand-muted uppercase tracking-wider">Over the site's visits</span>
		<span class="text-xs text-brand-muted">{loading ? 'Running…' : `${ordered.length} visits`}</span>
	</div>
	<div class="p-3 min-h-[200px]">
		{#if !siteId}
			<p class="text-sm text-brand-muted">Choose a site above to draw the set over its visits.</p>
		{:else if ordered.length === 0}
			<p class="text-sm text-brand-muted">No visit at this site holds every input the set reads.</p>
		{:else if failure}
			<p class="text-sm text-brand-muted">Not drawn: {failure}</p>
		{:else if drawn.length > 0}
			<UPlotChart {options} {data} class="w-full" />
		{:else if !loading}
			<p class="text-sm text-brand-muted">The set produced nothing at these visits.</p>
		{/if}
	</div>
</div>
