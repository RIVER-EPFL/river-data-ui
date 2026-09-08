<script lang="ts">
	// The Visits tab: the portal's wide data row, one per (site, date), with the per-visit grid
	// under an expanded row. The page hosts it and owns the flag dialog it opens.
	import { untrack } from 'svelte';
	import { downloadBlob } from '$lib/download';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { me } from '$auth/me.svelte';
	import { provenanceKindLabel } from '$lib/origin';
	import type { SiteParameter, ReprocessingJob } from '$api/crud';
	import {
		listSiteVisits,
		getCollectionEventDetail,
		recomputeCollectionEvent,
		runEventAudit,
		runEventRecompute,
		pollJob,
		type VisitRow,
		type VisitsResponse,
		type EventDetailResponse,
	} from '$api/service';
	import type { SampleReplicate } from '$lib/api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { formatMeasurement } from '$lib/format';
	import { cellRecord, estimatorWord, visitCellMarker, visitCellStatistics, visitCounts } from '$lib/visits/cell';
	import { cellRole } from '$lib/visits/role';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import PointInspector from '$components/provenance/PointInspector.svelte';

	interface FlagTarget {
		parameterId: string;
		parameterName: string;
		timeIso: string;
		replicates: SampleReplicate[];
		onSaved: () => void;
	}

	let {
		siteId,
		siteName,
		siteParameters,
		active,
		paramName,
		unitsForParameter,
		decimalsForParameter,
		visitPointLink,
		onFlag,
		onDataChanged,
	}: {
		siteId: string;
		siteName: string | null;
		siteParameters: SiteParameter[];
		/// Whether the tab is the one on screen: the grid loads when it is, not before.
		active: boolean;
		paramName: (paramId: string) => string;
		unitsForParameter: (paramId: string) => string | null;
		decimalsForParameter: (paramId: string) => number | null;
		visitPointLink: (eventId: string, parameterId: string) => string;
		onFlag: (target: FlagTarget) => void;
		/// A recompute wrote readings, so the page refetches what it plots.
		onDataChanged: () => void;
	} = $props();

	function openVisitFlag(visitId: string, replicates: SampleReplicate[]) {
		if (!visitCell || !visitDetail) return;
		const parameterId = visitCell.parameterId;
		onFlag({
			parameterId,
			parameterName: visitCell.parameterName,
			timeIso: visitDetail.collected_at,
			replicates,
			onSaved: () => void Promise.all([openVisit(visitId, true, parameterId), loadVisits()]),
		});
	}

	// --- Visits: the portal's wide data row, one per (site, date) ---
	let visits = $state<VisitRow[]>([]);
	let visitColumns = $state<VisitsResponse['expected_parameters']>([]);
	let visitsLoading = $state(false);
	let visitsLoadedKey = '';
	let expandedVisit = $state<string | null>(null);
	let visitDetail = $state<EventDetailResponse | null>(null);
	let visitDetailLoading = $state(false);
	let visitBusy = $state<string | null>(null);
	let visitCell = $state<{ parameterId: string; parameterName: string } | null>(null);

	// The date range filter. Unset lists every visit at the site, which is the default: a
	// station holds tens of visits, and the page devoted to them lists them all.
	let visitsStart = $state<string | null>(null);
	let visitsEnd = $state<string | null>(null);
	let visitsDownloading = $state(false);

	function visitsRange(): { start?: string; end?: string } {
		return {
			...(visitsStart ? { start: visitsStart } : {}),
			...(visitsEnd ? { end: visitsEnd } : {}),
		};
	}

	async function loadVisits() {
		visitsLoading = true;
		try {
			const r = await listSiteVisits(siteId, visitsRange());
			visits = r.visits;
			visitColumns = r.expected_parameters;
		} catch (e) {
			toastStore.error(e instanceof Error ? `Failed to load visits: ${e.message}` : 'Failed to load visits');
		} finally {
			visitsLoading = false;
		}
	}

	// The grid as displayed, one row per visit and one column per parameter code, named by site
	// and date range the way the server names it. The Export dialog is the other file: readings
	// in long format, one row per reading.
	async function downloadVisitsCsv() {
		if (visits.length === 0) return;
		visitsDownloading = true;
		try {
			const { auth } = await import('$auth/keycloak.svelte');
			await auth.ensureToken();
			const params = new URLSearchParams({ format: 'csv', ...visitsRange() });
			const response = await fetch(`/api/sites/${siteId}/visits?${params}`, {
				headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => response.statusText);
				throw new Error(`${response.status}: ${detail.slice(0, 200)}`);
			}
			const day = (iso: string) => iso.slice(0, 10);
			const first = visitsStart ? day(visitsStart) : day(visits[visits.length - 1].collected_at);
			const last = visitsEnd ? day(visitsEnd) : day(visits[0].collected_at);
			const slug = (siteName ?? 'site').replace(/[^A-Za-z0-9]/g, '_');
			downloadBlob(await response.blob(), `${slug}_visits_${first}_${last}.csv`);
		} catch (e) {
			toastStore.error(e instanceof Error ? `Download failed: ${e.message}` : 'Download failed');
		} finally {
			visitsDownloading = false;
		}
	}

	async function openVisit(id: string, forceOpen = false, selectParameterId: string | null = null) {
		if (expandedVisit === id && !forceOpen) {
			expandedVisit = null;
			visitDetail = null;
			visitCell = null;
			return;
		}
		expandedVisit = id;
		visitCell = null;
		visitDetail = null;
		visitDetailLoading = true;
		try {
			visitDetail = await getCollectionEventDetail(id);
			const selected = selectParameterId
				? visitDetail.cells.find((c) => c.parameter_id === selectParameterId)
				: null;
			if (selected) visitCell = { parameterId: selected.parameter_id, parameterName: selected.parameter_name };
			// A deep link can name a visit outside the current range; the range yields to it.
			if (visitDetail && !visits.some((v) => v.id === id)) {
				visitsStart = null;
				visitsEnd = null;
				visitsLoadedKey = '';
				await loadVisits();
			}
		} catch {
			toastStore.error('Failed to load the visit');
		} finally {
			visitDetailLoading = false;
		}
	}

	// A cell of the wide table is the click target: it expands the visit and selects the parameter,
	// so the record opens on what was clicked.
	function openVisitCell(id: string, parameterId: string) {
		if (expandedVisit === id && visitDetail) {
			const c = visitDetail.cells.find((c) => c.parameter_id === parameterId);
			visitCell = c ? { parameterId: c.parameter_id, parameterName: c.parameter_name } : null;
			return;
		}
		void openVisit(id, true, parameterId);
	}

	/// The badge on a cell the audit or the executor has an open finding about.
	function findingBadge(kind: string): string {
		switch (kind) {
			case 'stale_output':
				return 'stale';
			case 'skipped_output':
				return 'skipped';
			default:
				return 'missing';
		}
	}

	/// How a cell's readings reached the store. Absent a tool run they were not necessarily typed
	/// by a person: an import and a batch are different answers to that question.
	function originLabel(origin: string | undefined): string {
		switch (origin) {
			case 'manual':
				return 'hand-entered';
			case 'csv':
				return 'CSV import';
			case 'api':
				return 'API batch';
			case 'sync':
				return 'portal sync';
			default:
				return 'unknown origin';
		}
	}

	/// What the run actually did, from the counts the job records. "Visit audited" and "Visit
	/// audited" are the same sentence whether two stale findings opened or none did, so whether
	/// anything was found had to be inferred by re-reading the grid.
	const recomputeBadge: Record<string, { label: string; variant: 'muted' | 'accent' | 'alarm' | 'warning' }> = {
		queued: { label: 'recompute queued', variant: 'muted' },
		running: { label: 'recomputing', variant: 'accent' },
		failed: { label: 'recompute failed', variant: 'alarm' },
		stale: { label: 'stale output', variant: 'warning' },
	};

	function visitJobSummary(kind: 'recompute' | 'audit', job: ReprocessingJob): string {
		const counts = (job.detail?.counts ?? {}) as Record<string, number>;
		const parts =
			kind === 'recompute'
				? [
						`${counts.tools_run ?? 0} tool${counts.tools_run === 1 ? '' : 's'} run`,
						`${counts.readings_written ?? 0} written`,
						...(counts.tools_skipped ? [`${counts.tools_skipped} skipped`] : []),
					]
				: [
						`${counts.missing_findings ?? 0} missing`,
						`${counts.stale_findings ?? 0} stale`,
						...(counts.superseded ? [`${counts.superseded} closed`] : []),
					];
		const skipped = (job.detail?.scope as { skipped?: Array<{ tool?: string }> } | undefined)
			?.skipped;
		const named = skipped?.length
			? ` (${skipped.map((sk) => sk.tool ?? '?').join(', ')})`
			: '';
		return `${kind === 'recompute' ? 'Recomputed' : 'Audited'}: ${parts.join(', ')}${named}`;
	}

	// The scoped apply: every visit at this site with an open finding, in one tracked job.
	let staleApplyBusy = $state(false);
	const staleVisitCount = $derived(visits.filter((v) => v.recompute === 'stale').length);
	async function applyToStaleVisits() {
		staleApplyBusy = true;
		try {
			const r = await runEventRecompute({ site_id: siteId, only_findings: true });
			if (r.job_id) {
				const job = await pollJob(r.job_id);
				if (job.status === 'completed') {
					const counts = (job.detail?.counts ?? {}) as Record<string, number>;
					toastStore.success(
						`Recomputed ${counts.events_recomputed ?? 0} visit${(counts.events_recomputed ?? 0) === 1 ? '' : 's'}: ${counts.tools_run ?? 0} run, ${counts.tools_unchanged ?? 0} unchanged, ${counts.findings_closed ?? 0} finding${(counts.findings_closed ?? 0) === 1 ? '' : 's'} closed`,
					);
				} else {
					toastStore.error(job.error_message ?? 'The recompute job did not complete');
				}
			}
			await loadVisits();
			onDataChanged();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to recompute the stale visits');
		} finally {
			staleApplyBusy = false;
		}
	}

	// Recompute and audit are tracked jobs: enqueue, poll, then refresh the grid.
	async function runVisitJob(id: string, kind: 'recompute' | 'audit') {
		visitBusy = id;
		try {
			const r =
				kind === 'recompute'
					? await recomputeCollectionEvent(id)
					: await runEventAudit({ collection_event_id: id });
			if (r.job_id) {
				const job = await pollJob(r.job_id);
				if (job.status === 'completed') {
					toastStore.success(visitJobSummary(kind, job));
				} else {
					toastStore.error(job.error_message ?? `The ${kind} job did not complete`);
				}
			}
			await Promise.all([openVisit(id, true, visitCell?.parameterId ?? null), loadVisits()]);
			if (kind === 'recompute') onDataChanged();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : `Failed to ${kind} the visit`);
		} finally {
			visitBusy = null;
		}
	}

	$effect(() => {
		if (!active || !siteId) return;
		const key = `${siteId}|${visitsStart ?? ''}|${visitsEnd ?? ''}`;
		if (key === visitsLoadedKey) return;
		visitsLoadedKey = key;
		untrack(() => void loadVisits());
	});

	// A ?event= deep link expands its visit once the tab is active; with ?point= it opens that
	// parameter's record too.
	let consumedEventParam = '';
	$effect(() => {
		if (!active || siteParameters.length === 0) return;
		const ev = page.url.searchParams.get('event');
		if (!ev || ev === consumedEventParam) return;
		consumedEventParam = ev;
		const point = page.url.searchParams.get('point');
		const selectParam = siteParameters.find((s) => s.id === point)?.parameter_id ?? null;
		untrack(() => void openVisit(ev, true, selectParam));
	});
</script>

			<div class="space-y-3">
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<label for="visits-start" class="text-xs text-brand-muted block mb-1">From</label>
						<input
							id="visits-start"
							type="datetime-local"
							value={visitsStart ? toDatetimeLocal(visitsStart) : ''}
							onchange={(e) => { const v = e.currentTarget.value; visitsStart = v ? fromDatetimeLocal(v) : null; }}
							class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
						/>
					</div>
					<div>
						<label for="visits-end" class="text-xs text-brand-muted block mb-1">To</label>
						<input
							id="visits-end"
							type="datetime-local"
							value={visitsEnd ? toDatetimeLocal(visitsEnd) : ''}
							onchange={(e) => { const v = e.currentTarget.value; visitsEnd = v ? fromDatetimeLocal(v) : null; }}
							class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
						/>
					</div>
					{#if visitsStart || visitsEnd}
						<Button size="sm" onclick={() => { visitsStart = null; visitsEnd = null; }}>All dates</Button>
					{/if}
					<span class="text-sm text-brand-muted">{visits.length} visit{visits.length === 1 ? '' : 's'}{visitsStart || visitsEnd ? ' in range' : ''}</span>
					<span class="ml-auto flex items-center gap-1">
						<Button
							size="sm"
							variant="secondary"
							disabled={visitsDownloading || visits.length === 0}
							onclick={downloadVisitsCsv}
						>
							{visitsDownloading ? 'Downloading…' : 'Download grid CSV'}
						</Button>
						<span
							class="text-brand-muted cursor-help text-xs"
							title="This grid as displayed: one row per visit, one column per parameter code, the served value in each cell. For the readings themselves in long format (one row per reading, replicates and flags included) use Export."
						>(i)</span>
					</span>
				</div>
				{#if visitsLoading && visits.length === 0}
					<p class="text-sm text-brand-muted">Loading…</p>
				{:else if visits.length === 0}
					<p class="text-sm text-brand-muted">{visitsStart || visitsEnd ? 'No visits in this range.' : 'No visits recorded for this site.'}</p>
				{:else}
					{#if me.can('writeData')}
						<div class="flex items-center gap-2">
							<Button
								size="sm"
								variant="secondary"
								disabled={staleApplyBusy}
								title="Recompute every visit at this site with an open missing- or stale-output finding, in one tracked job. Unchanged calculations are skipped; the findings a run repairs close with it."
								onclick={applyToStaleVisits}
							>
								{staleApplyBusy ? 'Recomputing…' : `Recompute stale visits${staleVisitCount > 0 ? ` (${staleVisitCount} listed)` : ''}`}
							</Button>
						</div>
					{/if}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="bg-brand-bg text-left text-xs text-brand-muted">
									<th class="sticky left-0 z-10 bg-brand-bg px-4 py-2 font-medium">Date</th>
									<th class="px-3 py-2 font-medium">Source</th>
									<th class="px-3 py-2 font-medium">Filled</th>
									{#each visitColumns as col (col.parameter_id)}
										<th class="px-3 py-2 font-medium whitespace-nowrap" title={col.name}>
											{col.code}{#if unitsForParameter(col.parameter_id)}<span class="font-normal text-brand-muted"> ({unitsForParameter(col.parameter_id)})</span>{/if}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each visits as v (v.id)}
									{@const cellsById = new Map(v.cells.map((c) => [c.parameter_id, c]))}
									{@const extraCells = v.cells.filter(
										(c) => !visitColumns.some((col) => col.parameter_id === c.parameter_id),
									)}
									<tr class="border-t border-brand-divider hover:bg-brand-bg/50 {expandedVisit === v.id ? 'bg-brand-bg/50' : ''}">
										<td class="sticky left-0 z-10 bg-brand-surface px-4 py-2 whitespace-nowrap">
											<button
												type="button"
												class="cursor-pointer border-none bg-transparent p-0 text-left text-inherit hover:underline"
												aria-expanded={expandedVisit === v.id}
												title={expandedVisit === v.id ? 'Collapse this visit' : 'Expand this visit'}
												onclick={() => openVisit(v.id)}
											>{formatDateTime(v.collected_at)}</button>
											{#if v.findings_open > 0}
												<Badge variant="warning">{v.findings_open} finding{v.findings_open === 1 ? '' : 's'}</Badge>
											{/if}
											{#if recomputeBadge[v.recompute]}
												<Badge variant={recomputeBadge[v.recompute].variant}>{recomputeBadge[v.recompute].label}</Badge>
											{/if}
										</td>
										<td class="px-3 py-2">
											{#if v.source === 'portal_sync'}
												<Badge variant="accent">portal</Badge>
											{:else}
												<span class="text-brand-muted">{v.created_by ?? 'manual'}</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-brand-muted whitespace-nowrap">{v.parameters_filled}/{visitColumns.length}</td>
										{#each visitColumns as col (col.parameter_id)}
											{@const cell = cellsById.get(col.parameter_id)}
											<td
												class="px-3 py-2 tabular-nums whitespace-nowrap
													{cell?.finding === 'stale_output' || cell?.finding === 'skipped_output' ? 'bg-severity-warning-soft' : ''}
													{cell?.withdrawn ? 'text-brand-muted line-through' : ''}
													{cell?.flagged ? 'text-severity-warning' : ''}"
											>
												{#if !cell}
													<span class="text-brand-muted">-</span>
												{:else}
													<button
														type="button"
														class="cursor-pointer border-none bg-transparent p-0 text-inherit hover:underline"
														aria-pressed={expandedVisit === v.id && visitCell?.parameterId === col.parameter_id}
														title={[visitCellStatistics(cell, col.decimal_places, col.units), `Open the record of ${col.name} at this visit`].filter(Boolean).join('\n')}
														onclick={() => openVisitCell(v.id, col.parameter_id)}
													>
														{#if cell.finding === 'missing_output' && cell.value == null}
															<Badge variant="warning">missing</Badge>
														{:else if cell.value != null}
															{@const marker = visitCellMarker(cell)}
															{formatMeasurement(cell.value, col.decimal_places)}
															{#if (cell.n ?? 0) > 1}
																<span class="text-[10px] text-brand-muted align-super">n{cell.n}</span>
															{/if}
															{#if marker}
																<span class="text-severity-warning" title={marker.title}>{marker.text}</span>
															{/if}
														{:else}
															<span class="text-brand-muted">-</span>
														{/if}
													</button>
												{/if}
											</td>
										{/each}
										{#each extraCells as cell (cell.parameter_id)}
											<td class="px-3 py-2 tabular-nums whitespace-nowrap text-brand-muted">
												{#if cell.value != null}
													<button
														type="button"
														class="cursor-pointer border-none bg-transparent p-0 text-inherit hover:underline"
														aria-pressed={expandedVisit === v.id && visitCell?.parameterId === cell.parameter_id}
														title="Open the record of {paramName(cell.parameter_id)} at this visit"
														onclick={() => openVisitCell(v.id, cell.parameter_id)}
													>{formatMeasurement(cell.value, decimalsForParameter(cell.parameter_id))}</button>
												{:else}
													-
												{/if}
											</td>
										{/each}
									</tr>
									{#if expandedVisit === v.id}
										<tr class="border-t border-brand-divider">
											<td colspan={3 + visitColumns.length} class="bg-brand-bg/50 px-4 py-3">
												{#if visitDetailLoading}
													<p class="text-xs text-brand-muted">Loading…</p>
												{:else if visitDetail}
													{@const counts = visitCounts(visitDetail.cells)}
													<div class="mb-2 flex items-center justify-between gap-2">
														<div class="text-xs text-brand-muted">
															<span class="font-mono text-brand-text">
																{counts.parameters} parameter{counts.parameters === 1 ? '' : 's'} · {counts.replicates} replicate{counts.replicates === 1 ? '' : 's'} · {counts.flagged} flagged · {counts.withdrawn} withdrawn · {counts.findings} finding{counts.findings === 1 ? '' : 's'}
															</span>
															·
															{visitDetail.source === 'portal_sync'
																? 'Synced from the portal'
																: `Entered manually${visitDetail.created_by ? ` by ${visitDetail.created_by}` : ''}`}
															{#if visitDetail.notes}· {visitDetail.notes}{/if}
															{#if recomputeBadge[visitDetail.recompute]}
																<Badge variant={recomputeBadge[visitDetail.recompute].variant}>{recomputeBadge[visitDetail.recompute].label}</Badge>
															{/if}
														</div>
														{#if me.can('writeData')}
															<div class="flex gap-2">
																<a
																	class="rounded bg-brand-primary px-2 py-1 text-xs font-medium text-white hover:opacity-90"
																	href="{base}/visits/{v.id}"
																	onclick={(e) => e.stopPropagation()}>Open the grid</a
																>
																<Button
																	size="sm"
																	variant="secondary"
																	disabled={visitBusy === v.id}
																	onclick={(e) => { e.stopPropagation(); runVisitJob(v.id, 'recompute'); }}
																>{visitBusy === v.id ? 'Working…' : 'Recompute tools'}</Button>
																<Button
																	size="sm"
																	variant="ghost"
																	disabled={visitBusy === v.id}
																	onclick={(e) => { e.stopPropagation(); runVisitJob(v.id, 'audit'); }}
																>Audit this visit</Button>
															</div>
														{/if}
													</div>
													<table class="w-full text-xs">
														<thead class="text-brand-muted">
															<tr>
																<th class="py-1 pr-3 text-left font-medium">Parameter</th>
																<th class="py-1 pr-3 text-left font-medium">Served</th>
																<th class="py-1 pr-3 text-left font-medium">Replicates</th>
																<th class="py-1 pr-3 text-left font-medium">Provenance</th>
																<th class="py-1 text-left font-medium">Finding</th>
															</tr>
														</thead>
														<tbody>
															{#each visitDetail.cells as cell (cell.parameter_id + cell.stream_id)}
																<tr
																	class="border-t border-brand-divider/60 cursor-pointer hover:bg-brand-bg/60 {visitCell?.parameterId === cell.parameter_id ? 'bg-brand-bg' : ''}"
																	aria-selected={visitCell?.parameterId === cell.parameter_id}
																	onclick={() => (visitCell = { parameterId: cell.parameter_id, parameterName: cell.parameter_name })}
																>
																	<td class="py-1 pr-3">
																		<button
																			type="button"
																			class="cursor-pointer border-none bg-transparent p-0 text-left text-inherit hover:underline"
																			aria-pressed={visitCell?.parameterId === cell.parameter_id}
																			onclick={() => (visitCell = { parameterId: cell.parameter_id, parameterName: cell.parameter_name })}
																		>{cell.parameter_name}</button>
																		{#if unitsForParameter(cell.parameter_id)}<span class="text-brand-muted">({unitsForParameter(cell.parameter_id)})</span>{/if}
																		{#if cellRole(cell).title}
																			<span
																				class="ml-1.5 rounded px-1 text-[10px] {cellRole(cell).role === 'output'
																					? 'bg-brand-accent/15 text-brand-accent-dark'
																					: 'bg-brand-primary/10 text-brand-primary'}"
																				title={cellRole(cell).title}
																			>{cellRole(cell).role === 'output' ? cell.written_by : `→ ${(cell.read_by ?? []).join(', ')}`}</span>
																		{/if}
																	</td>
																	<td class="py-1 pr-3 tabular-nums">
																		{formatMeasurement(cell.served_value, decimalsForParameter(cell.parameter_id))}
																		{#if cell.sample && cell.sample.n >= 2 && cell.sample.stdev != null}
																			<span
																				class="text-brand-muted"
																				title={[
																					`SD ${cell.sample.stdev} (${estimatorWord(cell.sample.sd_estimator)})`,
																					cell.sample.sd_estimator_source === 'default'
																						? 'divisor not declared for this parameter'
																						: null,
																					cell.sample.stdev_sample != null
																						? `sample, n-1: ${cell.sample.stdev_sample}`
																						: null,
																					cell.sample.stdev_population != null
																						? `population, n: ${cell.sample.stdev_population}`
																						: null,
																					cell.sample.median != null ? `median ${cell.sample.median}` : null,
																					cell.sample.min != null && cell.sample.max != null
																						? `range ${cell.sample.min} to ${cell.sample.max}`
																						: null,
																				]
																					.filter(Boolean)
																					.join('\n')}
																			>±{formatMeasurement(cell.sample.stdev, decimalsForParameter(cell.parameter_id))} ({estimatorWord(cell.sample.sd_estimator)}, n={cell.sample.n})</span>
																		{/if}
																	</td>
																	<td class="py-1 pr-3 tabular-nums text-brand-muted">
																		{cell.replicates
																			.map((r) => `${formatMeasurement(r.calibrated_value ?? r.raw_value, decimalsForParameter(cell.parameter_id))}${r.flagged ? '*' : ''}${r.withdrawn ? '†' : ''}`)
																			.join(', ')}
																	</td>
																	<td class="py-1 pr-3">
																		{#if cell.has_provenance}
																			<Badge variant="ok">{cell.tool ?? 'tool run'}</Badge>
																		{:else}
																			<span class="text-brand-muted">{provenanceKindLabel(cell.provenance_kind) ?? originLabel(cell.origin)}</span>
																		{/if}
																	</td>
																	<td class="py-1">
																		{#if cell.finding}
																			<Badge variant="warning">{findingBadge(cell.finding.kind)}</Badge>
																		{:else}
																			<span class="text-brand-muted">-</span>
																		{/if}
																	</td>
																</tr>
															{/each}
														</tbody>
													</table>
													{#if visitDetail.cells.some((c) => c.replicates.some((r) => r.flagged || r.withdrawn))}
														<p class="mt-1 text-[11px] text-brand-muted">* flagged · † withdrawn at source</p>
													{/if}
													{#if visitCell}
														<PointInspector
															siteId={siteId}
															parameterId={visitCell.parameterId}
															parameterName={visitCell.parameterName}
															units={unitsForParameter(visitCell.parameterId)}
															decimals={decimalsForParameter(visitCell.parameterId)}
															timeIso={visitDetail.collected_at}
															measurementType="spot"
															preloaded={cellRecord(visitDetail, visitCell.parameterId)}
															link={visitPointLink(v.id, visitCell.parameterId)}
															onclose={() => (visitCell = null)}
															onflag={(reps) => openVisitFlag(v.id, reps)}
														/>
													{/if}
												{/if}
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
					{#if visits.some((v) => v.cells.some((c) => visitCellMarker(c)))}
						<p class="text-[11px] text-brand-muted">* flagged · † withdrawn at source</p>
					{/if}
				{/if}
			</div>
