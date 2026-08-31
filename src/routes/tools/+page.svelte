<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { me } from '$auth/me.svelte';
	import {
		listTools,
		calculateTool,
		type ToolDescriptor,
		type ToolCalculateResponse,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { type CurveSelection } from '$components/tools/CurvePicker.svelte';
	import SaveResultsPanel, { type UsedCurve } from '$components/tools/SaveResultsPanel.svelte';
	import StagedVisitBar from '$components/tools/StagedVisitBar.svelte';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import ToolForm from '$components/tools/ToolForm.svelte';
	import {
		buildRequestBody,
		curveSelectionsFrom,
		initFormState,
		type FormState,
	} from '$lib/tools/form';

	let tools = $state<ToolDescriptor[]>([]);
	let loadError = $state('');
	let loading = $state(true);
	let search = $state('');

	const canAuthor = $derived(me.can('admin'));

	let activeTool = $state<ToolDescriptor | null>(null);
	let form = $state<FormState>({
		values: {},
		bools: {},
		arrays: {},
		structs: {},
		series: {},
		shapes: {},
	});
	let curveSelections = $state<Record<string, CurveSelection>>({});
	let result = $state<ToolCalculateResponse | null>(null);
	let resultInputs = $state<Record<string, unknown> | null>(null);
	let resultCurves = $state<UsedCurve[]>([]);
	let calculating = $state(false);
	let showSaveDialog = $state(false);

	// Calculation context: the staged field visit. Every tool run carries the visit's station and
	// instant, so a tool that declares station or event inputs resolves them from the same row the
	// save writes into. Fill-if-missing (a typed value always wins), so the context is offered,
	// never required, except where the manifest requires a station property.
	let visitBar = $state<{ begin: () => void } | null>(null);
	const contextSiteId = $derived(stagedVisit.current?.siteId ?? '');
	const contextIso = $derived(stagedVisit.current?.collectedAt ?? '');
	const needsContext = $derived(
		!!activeTool &&
			((activeTool.station_inputs?.length ?? 0) > 0 || (activeTool.event_inputs?.length ?? 0) > 0),
	);

	// Every tool the API serves is listed, so a tool added in the portal appears without a UI
	// change. Keywords widen the search without deciding where a tool belongs.
	const visibleTools = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const matches = (t: ToolDescriptor) =>
			q === '' ||
			[t.label, t.description ?? '', t.name, ...t.match_keywords]
				.join(' ')
				.toLowerCase()
				.includes(q);
		return tools.filter(matches).sort((a, b) => a.label.localeCompare(b.label));
	});

	function selectTool(tool: ToolDescriptor, prefill?: Record<string, unknown>) {
		activeTool = tool;
		result = null;
		resultInputs = null;
		resultCurves = [];
		form = initFormState(tool, prefill);
		curveSelections = curveSelectionsFrom(tool, prefill);
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
		return out;
	}

	async function calculate() {
		if (!activeTool) return;
		const built = buildRequestBody(activeTool, form, curveSelections);
		if ('error' in built) {
			toastStore.error(built.error);
			return;
		}
		calculating = true;
		result = null;
		try {
			const body = { ...built.body };
			if (contextSiteId) {
				body.site_id = contextSiteId;
				if (contextIso) body.collected_at = contextIso;
			}
			const res = await calculateTool(activeTool.name, body);
			result = res;
			// Snapshots taken now: the provenance records what these numbers were computed with,
			// not whatever the form holds later.
			resultInputs = built.body;
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

<svelte:head><title>Tools | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<StagedVisitBar bind:this={visitBar} />

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
		<input
			type="search"
			bind:value={search}
			placeholder="Search tools…"
			aria-label="Search tools"
			class="w-full sm:w-72 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
			{#each visibleTools as tool (tool.name)}
				<button
					onclick={() => selectTool(tool)}
					class="text-left p-4 rounded-md border border-brand-divider bg-brand-surface cursor-pointer hover:shadow-sm transition-shadow"
				>
					<div class="font-semibold text-sm">{tool.label}</div>
					<div class="text-xs text-brand-muted mt-1">{tool.description}</div>
				</button>
			{/each}
		</div>
		{#if visibleTools.length === 0}
			<p class="text-sm text-brand-muted">No tool matches that search.</p>
		{/if}
	{:else}
		<div class="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6">
			<div class="space-y-4">
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
					<div class="flex items-baseline justify-between gap-2 mb-1">
						<h3 class="text-base font-semibold">{activeTool.label}</h3>
						<div class="flex items-baseline gap-3">
							<span class="text-xs text-brand-muted">Version {activeTool.version_no}</span>
							{#if canAuthor}
								<!-- Authoring is Administrator only, so the link is offered to the same level
								     the /tools/manage page admits. -->
								<a
									href="{base}/tools/manage?script={encodeURIComponent(activeTool.name)}"
									class="text-xs text-brand-primary hover:underline">Edit tool</a
								>
							{/if}
						</div>
					</div>
					<p class="text-sm text-brand-muted mb-4">{activeTool.description}</p>

					<form onsubmit={(e) => { e.preventDefault(); calculate(); }} class="space-y-3">
						{#if needsContext}
							<div class="rounded-md border border-brand-divider bg-brand-bg p-3 space-y-2">
								<p class="text-xs font-semibold">Calculation context</p>
								<p class="text-xs text-brand-muted">
									This tool reads
									{[
										...(activeTool.station_inputs ?? []).map((si) => `the station's ${si.property}`),
										...(activeTool.event_inputs ?? []).map((ei) => `${ei.parameter_code} from the same visit`),
									].join(', ')}. Values you type below always win; the rest resolve from the
									staged visit.
								</p>
								{#if !contextSiteId}
									<div class="flex items-center gap-2">
										<p class="text-xs text-severity-warning-text">
											No visit is staged, so nothing resolves from the station or the visit.
										</p>
										<Button variant="secondary" size="sm" onclick={() => visitBar?.begin()}>
											Stage a field visit
										</Button>
									</div>
								{/if}
							</div>
						{/if}
						<ToolForm spec={activeTool} bind:form bind:curveSelections />

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
						{#if (result.station_inputs?.length ?? 0) > 0 || (result.event_inputs?.length ?? 0) > 0}
							<div class="text-xs text-brand-muted bg-brand-bg border border-brand-divider rounded-md px-2 py-1 mb-2 space-y-0.5">
								{#each result.station_inputs ?? [] as si}
									<p>Resolved {si.param} = {si.value} from the station's {si.property}.</p>
								{/each}
								{#each result.event_inputs ?? [] as ei}
									<p>Resolved {ei.param} = {ei.value} from {ei.parameter_code} at this visit.</p>
								{/each}
							</div>
						{/if}
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
	contextSiteId={contextSiteId || null}
	contextTime={contextIso || null}
	visitLocked={!!stagedVisit.current}
	onsaved={() => stagedVisit.refresh()}
	runId={result?.run_id ?? null}
	toolName={activeTool?.name ?? ''}
	toolTitle={activeTool?.label ?? ''}
	results={result?.results ?? null}
	outputs={activeTool?.outputs ?? []}
	toolParams={activeTool?.params ?? []}
	toolVersion={result?.tool_version ?? null}
	calcInputs={resultInputs}
	curvesUsed={resultCurves}
	serverConstants={result?.constants ?? null}
	serverCurves={result?.curves ?? []}
	{appliedCurveLabel}
/>
