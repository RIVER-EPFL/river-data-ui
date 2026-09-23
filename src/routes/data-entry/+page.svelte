<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { me } from '$auth/me.svelte';
	import {
		listTools,
		calculateTool,
		previewTool,
		reloadToolRun,
		listVisits,
		type ToolDescriptor,
		type ToolOutput,
		type ToolCalculateResponse,
		type ToolPreviewResponse,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { type CurveSelection } from '$components/tools/CurvePicker.svelte';
	import SaveResultsPanel, { type UsedCurve } from '$components/tools/SaveResultsPanel.svelte';
	import StagedVisitBar from '$components/tools/StagedVisitBar.svelte';
	import { stagedVisit, stagedVisitFrom, type StagedVisit } from '$lib/stores/visit.svelte';
	import {
		openedFrom,
		prefillFromVisit,
		reopenStaging,
		runVisit,
		type OpenedFrom,
	} from '$lib/tools/visitPrefill';
	import { formatDateTime } from '$lib/utils';
	import { runTables } from '$lib/tools/runTable';
	import ToolForm from '$components/tools/ToolForm.svelte';
	import RunResultsTable from '$components/tools/RunResultsTable.svelte';
	import { toolboxHref } from '$lib/toolbox/route';
	import { entrySnapshot, hasUnsavedValues, previewScheduler } from '$lib/tools/liveEntry';
	import {
		buildRequestBody,
		curveSelectionsFrom,
		initFormState,
		openingFromRun,
		type FormState,
	} from '$lib/tools/form';

	let tools = $state<ToolDescriptor[]>([]);
	let loadError = $state('');
	/** What reopening a run did to the visit chosen before it, said once beside the visit bar. */
	let reopenNotice = $state('');
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
	// A preview while typing; the stored run once Save to Site stores it, which is the only run a
	// save can name.
	let result = $state<ToolPreviewResponse | ToolCalculateResponse | null>(null);
	let previewNote = $state('');
	let snapshot = $state<string | null>(null);
	// The values the stored run was computed from, which are what a save writes.
	let savedCandidate: string | null = null;
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
		snapshot = entrySnapshot(form, curveSelections);
		opened = from;
	}

	// Back to the values the form opened or was last saved with, discarding what was typed since.
	function resetForm() {
		if (!snapshot) return;
		[form, curveSelections] = JSON.parse(snapshot) as [FormState, Record<string, CurveSelection>];
	}

	const unsaved = $derived(hasUnsavedValues(snapshot, form, curveSelections));
	const UNSAVED = 'These new values are not saved yet. Leave anyway?';

	beforeNavigate((navigation) => {
		if (unsaved && navigation.type !== 'leave' && !confirm(UNSAVED)) navigation.cancel();
	});

	function warnBeforeUnload(event: BeforeUnloadEvent) {
		if (unsaved) event.preventDefault();
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

	function contextual(body: Record<string, unknown>): Record<string, unknown> {
		const out = { ...body };
		if (contextSiteId) {
			out.site_id = contextSiteId;
			if (contextIso) out.collected_at = contextIso;
		}
		return out;
	}

	interface Previewed {
		res: ToolPreviewResponse | null;
		inputs: Record<string, unknown> | null;
		curves: UsedCurve[];
	}

	// The inputs and curves travel with the result, so the check and the save panel read the values
	// this result was computed from before Save opens.
	async function preview(): Promise<Previewed> {
		const none: Previewed = { res: null, inputs: null, curves: [] };
		if (!activeTool) return none;
		const built = buildRequestBody(activeTool, form, curveSelections);
		if ('error' in built) {
			previewNote = built.error;
			return none;
		}
		const curves = usedCurves();
		try {
			const res = await previewTool(activeTool.name, contextual(built.body));
			previewNote = '';
			return { res, inputs: built.body, curves };
		} catch (e) {
			previewNote = e instanceof Error ? e.message : 'Calculation failed';
			return none;
		}
	}

	const scheduler = previewScheduler(preview, (p) => {
		result = p.res;
		resultInputs = p.inputs;
		resultCurves = p.curves;
	});

	// Every typed value, curve and context change previews the calculation once typing pauses.
	$effect(() => {
		if (!activeTool) return;
		entrySnapshot(form, curveSelections);
		void contextSiteId;
		void contextIso;
		scheduler.schedule();
	});

	// Save stores the run it names: the values on screen are computed once more, kept, and handed
	// to the save step.
	async function openSave() {
		if (!activeTool) return;
		const built = buildRequestBody(activeTool, form, curveSelections);
		if ('error' in built) {
			toastStore.error(built.error);
			return;
		}
		scheduler.cancel();
		calculating = true;
		try {
			savedCandidate = entrySnapshot(form, curveSelections);
			result = await calculateTool(activeTool.name, contextual(built.body));
			// Snapshots taken now: the provenance records what these numbers were computed with,
			// not whatever the form holds later.
			resultInputs = built.body;
			resultCurves = usedCurves();
			showSaveDialog = true;
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

	function visitText(visit: Pick<StagedVisit, 'siteName' | 'collectedAt'>): string {
		return `${visit.siteName}, ${formatDateTime(visit.collectedAt)}`;
	}

	// A reopened run is saved at the visit it was computed at, so that visit is the one staged.
	async function stageRunVisit(body: Record<string, unknown>) {
		const decision = reopenStaging(runVisit(body), stagedVisit.current);
		if (decision.action === 'keep') return;
		if (decision.action === 'clear') {
			stagedVisit.clear();
			reopenNotice = `This run was computed at no visit, so ${visitText(decision.replaced)} is no longer chosen.`;
			return;
		}
		const { siteId, collectedAt } = decision.visit;
		const found = await listVisits({ site_id: siteId, start: collectedAt, end: collectedAt, page_size: 1 });
		const row = found.items[0];
		if (!row) {
			stagedVisit.clear();
			reopenNotice = 'The visit this run was computed at no longer exists: choose one before saving.';
			return;
		}
		stagedVisit.set(stagedVisitFrom(row, row.site_name));
		if (decision.replaced) {
			reopenNotice = `Opened at the visit this run was computed at, ${visitText({ siteName: row.site_name, collectedAt: row.collected_at })}, in place of ${visitText(decision.replaced)}.`;
		}
	}

	// ?tool= names the tool; ?reload= names a stored run to reopen it on.
	function applyPrefill(loaded: ToolDescriptor[]) {
		const wanted = page.url.searchParams.get('tool');
		if (!wanted) return;
		const tool = loaded.find((t) => t.name === wanted);
		if (!tool) return;
		const from = openedFrom(page.url.searchParams);
		const runId = page.url.searchParams.get('reload');
		if (runId) {
			// The edit dialog stashes the run it read, so reopening does not fetch it twice.
			let stashed: { tool?: string; body?: Record<string, unknown>; curves?: unknown[] } | null = null;
			try {
				const raw = sessionStorage.getItem('tool-reload');
				stashed = raw ? JSON.parse(raw) : null;
			} catch {
				stashed = null;
			}
			sessionStorage.removeItem('tool-reload');
			const reading =
				stashed?.tool === wanted && stashed.body && typeof stashed.body === 'object'
					? Promise.resolve({ body: stashed.body, curves: stashed.curves })
					: reloadToolRun(runId);
			reading
				.then(async (run) => {
					await stageRunVisit(run.body);
					selectTool(tool, openingFromRun(run), from);
				})
				.catch((e: unknown) => {
					loadError = e instanceof Error ? e.message : String(e);
				});
			return;
		}
		selectTool(tool, undefined, from);
	}

</script>

<svelte:head><title>Data entry | RIVER Data</title></svelte:head>
<svelte:window onbeforeunload={warnBeforeUnload} />

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Data entry</h2>
		{#if activeTool}
			<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => { if (unsaved && !confirm(UNSAVED)) return; scheduler.cancel(); activeTool = null; result = null; snapshot = null; }}>&larr; All forms</Button>
		{/if}
	</div>

	<StagedVisitBar bind:this={visitBar} />
	{#if reopenNotice}
		<p class="text-sm text-severity-warning-text">{reopenNotice}</p>
	{/if}

	{#if loadError}
		<ErrorNotice message={loadError} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading forms…</p>
	{:else if !activeTool}
		<input
			type="search"
			bind:value={search}
			placeholder="Search forms…"
			aria-label="Search forms"
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
			<p class="text-sm text-brand-muted">No form matches that search.</p>
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
								     the Toolbox admits. -->
								<a
									href={toolboxHref(base, activeTool.name)}
									class="text-xs text-brand-primary hover:underline">Edit tool</a
								>
							{/if}
						</div>
					</div>
					<p class="text-sm text-brand-muted mb-4">{activeTool.description}</p>

					<form onsubmit={(e) => { e.preventDefault(); scheduler.schedule(); }} class="space-y-3">
						{#if needsContext}
							<div class="rounded-md border border-brand-divider bg-brand-bg p-3 space-y-2">
								<p class="text-xs font-semibold">Calculation context</p>
								<p class="text-xs text-brand-muted">
									This tool reads
									{[
										...(activeTool.site_inputs ?? []).map((si) => `the site's ${si.property}`),
										...(activeTool.event_inputs ?? []).map((ei) => `${ei.parameter_code} from the same visit`),
									].join(', ')}. Values you type below always win; the rest resolve from the
									chosen visit.
								</p>
								{#if !contextSiteId}
									<div class="flex items-center gap-2">
										<p class="text-xs text-severity-warning-text">
											No visit is chosen, so nothing resolves from the site or the visit.
										</p>
										<Button variant="secondary" size="sm" onclick={() => visitBar?.begin()}>
											Choose a field visit
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

						<Button variant="secondary" disabled={!unsaved} onclick={resetForm}
							title="Discard the values typed since the form opened or was last saved">Reset</Button>
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
								disabled={calculating}
								onclick={openSave}
							>{calculating ? 'Calculating…' : 'Save to Site'}</Button>
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
						<RunResultsTable tables={resultTables} trace={result?.trace ?? []} />
						<SaveResultsPanel
							bind:open={showSaveDialog}
							contextSiteId={contextSiteId || null}
							contextTime={contextIso || null}
							visitLocked={!!stagedVisit.current}
							visitRecompute={stagedVisit.detail?.recompute}
							onsaved={() => {
								if (savedCandidate) snapshot = savedCandidate;
								return stagedVisit.refresh();
							}}
							runId={result && 'run_id' in result ? result.run_id : null}
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
					</div>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-4 flex items-center justify-center h-40 text-sm text-brand-muted">
						{previewNote || 'Enter values to see the calculation'}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

