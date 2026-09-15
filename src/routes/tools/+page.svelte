<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { me } from '$auth/me.svelte';
	import {
		listTools,
		calculateTool,
		reloadToolRun,
		type ToolDescriptor,
		type ToolOutput,
		type ToolCalculateResponse,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { type CurveSelection } from '$components/tools/CurvePicker.svelte';
	import SaveResultsPanel, { type UsedCurve } from '$components/tools/SaveResultsPanel.svelte';
	import StagedVisitBar from '$components/tools/StagedVisitBar.svelte';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { openedFrom, prefillFromVisit, type OpenedFrom } from '$lib/tools/visitPrefill';
	import { runTables } from '$lib/tools/runTable';
	import ToolForm from '$components/tools/ToolForm.svelte';
	import RunResultsTable from '$components/tools/RunResultsTable.svelte';
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
	let opened = $state<OpenedFrom>('fresh');
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

	// Calculation context: the staged field visit. Every tool run carries the visit's site and
	// instant, so a tool that declares site or event inputs resolves them from the same row the
	// save writes into. Fill-if-missing (a typed value always wins), so the context is offered,
	// never required, except where the manifest requires a site property.
	let visitBar = $state<{ begin: () => void } | null>(null);
	const contextSiteId = $derived(stagedVisit.current?.siteId ?? '');
	const contextIso = $derived(stagedVisit.current?.collectedAt ?? '');
	const needsContext = $derived(
		!!activeTool &&
			((activeTool.site_inputs?.length ?? 0) > 0 || (activeTool.event_inputs?.length ?? 0) > 0),
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

	// A tool opens on what the staged visit already holds (M4): the stored replicates in the
	// source's own column order with their curve preselected, and the scalars the tool reads from
	// the visit. An explicit reload wins over it, because that names a run rather than a visit.
	function selectTool(
		tool: ToolDescriptor,
		prefill?: Record<string, unknown>,
		from: OpenedFrom = 'fresh',
	) {
		activeTool = tool;
		result = null;
		resultInputs = null;
		resultCurves = [];
		const cells = stagedVisit.detail?.cells ?? [];
		const opening = { ...prefillFromVisit(tool, cells), ...(prefill ?? {}) };
		form = initFormState(tool, opening);
		curveSelections = curveSelectionsFrom(tool, opening);
		opened = from;
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

	// One shape for both tables, so a run reads as the portal's: parameters down, replicates
	// across, the steps of the calculation above what it publishes.
	const resultTables = $derived(
		runTables(
			(result?.results ?? {}) as Record<string, unknown>,
			activeTool?.outputs ?? [],
			(result?.skipped ?? []) as Array<Record<string, unknown>>,
			result?.trace ?? [],
		),
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
		const from = openedFrom(page.url.searchParams);
		const runId = page.url.searchParams.get('reload');
		if (runId) {
			// The edit dialog stashes the run it read, so reopening does not fetch it twice.
			try {
				const raw = sessionStorage.getItem('tool-reload');
				if (raw) {
					const run = JSON.parse(raw) as { tool?: string; body?: Record<string, unknown> };
					if (run.tool === wanted && run.body && typeof run.body === 'object') inputs = run.body;
				}
			} catch {
				inputs = undefined;
			}
			sessionStorage.removeItem('tool-reload');
			if (!inputs) {
				reloadToolRun(runId)
					.then((run) => selectTool(tool, run.body, from))
					.catch((e: unknown) => {
						loadError = e instanceof Error ? e.message : String(e);
					});
				return;
			}
		}
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
		selectTool(tool, inputs, from);
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
										...(activeTool.site_inputs ?? []).map((si) => `the site's ${si.property}`),
										...(activeTool.event_inputs ?? []).map((ei) => `${ei.parameter_code} from the same visit`),
									].join(', ')}. Values you type below always win; the rest resolve from the
									staged visit.
								</p>
								{#if !contextSiteId}
									<div class="flex items-center gap-2">
										<p class="text-xs text-severity-warning-text">
											No visit is staged, so nothing resolves from the site or the visit.
										</p>
										<Button variant="secondary" size="sm" onclick={() => visitBar?.begin()}>
											Stage a field visit
										</Button>
									</div>
								{/if}
							</div>
						{/if}
						{#if opened === 'visit-last-run'}
							<p class="text-xs text-brand-muted">
								{activeTool.curves.length > 0
									? 'Opened with the curve this visit’s last run used.'
									: 'Opened with what this visit’s last run of this calculation used.'}
							</p>
						{/if}
						<ToolForm spec={activeTool} bind:form bind:curveSelections siteId={contextSiteId || null} />

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
						{#if (result.site_inputs?.length ?? 0) > 0 || (result.event_inputs?.length ?? 0) > 0}
							<div class="text-xs text-brand-muted bg-brand-bg border border-brand-divider rounded-md px-2 py-1 mb-2 space-y-0.5">
								{#each result.site_inputs ?? [] as si}
									<p>Resolved {si.param} = {si.value} from the site's {si.property}.</p>
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
						<RunResultsTable tables={resultTables} />
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
	eventInputs={activeTool?.event_inputs ?? []}
	visitCells={stagedVisit.detail?.cells ?? []}
	toolVersion={result?.tool_version ?? null}
	calcInputs={resultInputs}
	curvesUsed={resultCurves}
	serverConstants={result?.constants ?? null}
	serverCurves={result?.curves ?? []}
	{appliedCurveLabel}
/>
