<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import {
		listReplicateAudits,
		acknowledgeReplicateAudit,
		acknowledgeReplicateAuditsBulk,
		resolveReplicateAudit,
		reopenReplicateAudit,
		listUndeclaredSdEstimators,
		previewSample,
		type SamplePreviewResponse,
		type SdEstimator,
		type UndeclaredEstimatorSlot,
		issueSyncCommand,
		getSyncCommand,
		stageCollectionEvent,
		recomputeCollectionEvent,
		pollJob,
		type ReplicateAuditHold,
		type HoldKind,
		type SyncCommand,
		type SyncService,
	} from '$api/service';
	import { getList } from '$api/client';
	import { resyncServiceFor } from '$lib/sync/resync';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime, holdKindLabel } from '$lib/utils';
	import { estimatorLabel, sdFormulaTitle, sdRowLabel } from '$lib/sdEstimator';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import CountList from '$components/ui/CountList.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	const PER_PAGE = 100;

	// Three views instead of raw DB statuses: what needs a decision, what has one, and what is
	// waiting on pairing. 'resolved' is a server-side meta-status covering every past-review state.
	type View = 'review' | 'resolved' | 'deferred';

	let {
		onPendingChange,
		initialView = 'review',
		initialStreamIds,
		initialClassification,
		initialFocusLabel,
		initialHoldId,
	}: {
		onPendingChange?: (pending: number) => void;
		initialView?: View;
		// A caller arriving from evidence it quoted elsewhere (the pairing review's divisor
		// counts) hands over the exact set it counted, so the queue opens on those holds rather
		// than on the whole backlog.
		initialStreamIds?: string[];
		initialClassification?: 'population_sd' | 'not_population_sd';
		initialFocusLabel?: string;
		// One hold a point record linked to; the queue opens on it alone.
		initialHoldId?: string;
	} = $props();

	// Deliberate initial-value capture: the view is user-navigable after mount.
	// svelte-ignore state_referenced_locally
	let view = $state<View>(initialView);
	let deferredCount = $state(0);
	let acknowledging = $state(false);
	// Slots serving statistics under no declared sd estimator. The audit is what surfaces the
	// missing specification, so the banner and the per-hold actions both read this.
	let undeclared = $state<UndeclaredEstimatorSlot[]>([]);
	// Which divisor the operator is about to declare, per hold being viewed.
	let declareChoice = $state<SdEstimator>('population');
	// Server-side, so largest-first triage works across the whole backlog, not one page.
	let sortByScale = $state<'relative_delta_desc' | 'relative_delta_asc' | null>(null);
	// '' = all sources; a specific value both filters the list and targets the resync button.
	let sourceFilter = $state('');
	// The stream restriction a caller arrived with, cleared by the operator in one click. Only
	// this one stays a chip: a set of stream ids has no honest dropdown.
	// svelte-ignore state_referenced_locally
	let focusStreamIds = $state<string[] | null>(initialStreamIds ?? null);
	// svelte-ignore state_referenced_locally
	let focusHoldId = $state<string | null>(initialHoldId ?? null);
	// The two remaining server-side filters, as controls rather than arrival-only restrictions.
	// A caller arriving with a signature preselects the same dropdown the operator can drive.
	// svelte-ignore state_referenced_locally
	let focusClassification = $state<'population_sd' | 'not_population_sd' | ''>(
		initialClassification ?? '',
	);
	// '' = both. 'false' is the set the acknowledgement gate blocks: their slot has declared no
	// standard-deviation formula.
	let estimatorFilter = $state<'' | 'true' | 'false'>('');

	// Threshold bulk accept: one ceiling per statistic (percent of the mean magnitude), combined
	// with AND, plus the live count of pending holds the pair would acknowledge. The sd ceiling is
	// looser by default because the systematic sd offsets (population-vs-sample, source rounding)
	// are larger than the mean ones. 25% is the meter's display cap: the systematic-offset classes
	// sit comfortably inside it while genuinely stale aggregates render as a full bar.
	const METER_CAP_PCT = 25;
	let meanThresholdPct = $state(0.5);
	let sdThresholdPct = $state(5);
	let thresholdCount = $state<number | null>(null);
	let thresholdTimer: ReturnType<typeof setTimeout> | undefined;

	// Resync: the sync service able to re-send the filtered source's data on demand.
	let syncServices = $state<SyncService[]>([]);
	let visibleSources = $state<string[]>([]);
	let requestingSync = $state(false);
	// The issued command, polled so its progress is visible here rather than on the System page.
	let issuedCommand = $state<SyncCommand | null>(null);
	let commandTimer: ReturnType<typeof setTimeout> | undefined;

	const sourceOptions = $derived(
		[...new Set([...syncServices.map((s) => s.service_type), ...visibleSources])].sort(),
	);

	const syncService = $derived(resyncServiceFor(syncServices, sourceFilter));

	function pollCommand(id: string, deadline: number) {
		clearTimeout(commandTimer);
		commandTimer = setTimeout(async () => {
			try {
				const cmd = await getSyncCommand(id);
				issuedCommand = cmd;
				if (cmd.status === 'pending' || cmd.status === 'acknowledged') {
					if (Date.now() < deadline) pollCommand(id, deadline);
				}
			} catch {
				// Polling is best-effort; the System page still shows the command.
			}
		}, 3000);
	}

	async function requestSyncNow() {
		if (!syncService) return;
		requestingSync = true;
		try {
			const cmd = await issueSyncCommand(syncService.id, 'trigger_full_sync');
			issuedCommand = cmd;
			pollCommand(cmd.id, Date.now() + 120_000);
			toastStore.success(`Full sync requested from ${syncService.instance_id}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to request sync');
		} finally {
			requestingSync = false;
		}
	}

	function commandChip(cmd: SyncCommand): { label: string; alarm: boolean } {
		switch (cmd.status) {
			case 'pending': return { label: 'queued', alarm: false };
			case 'acknowledged':
				return { label: `received by ${syncService?.instance_id ?? sourceFilter}`, alarm: false };
			case 'completed': return { label: 'completed', alarm: false };
			case 'failed': return { label: 'failed', alarm: true };
			default: return { label: 'expired', alarm: true };
		}
	}

	onMount(async () => {
		try {
			syncServices = (await getList<SyncService>('/api/sync_services', { perPage: 50 })).data;
		} catch {
			// Listing may be denied; the resync button stays disabled with its tooltip.
		}
	});

	onDestroy(() => {
		clearTimeout(commandTimer);
		clearTimeout(thresholdTimer);
	});

	const VIEW_STATUS: Record<View, string> = {
		review: 'pending',
		resolved: 'resolved',
		deferred: 'deferred',
	};

	async function loadPage({ page, perPage }: { page: number; perPage: number }) {
		const result = await listReplicateAudits({
			page,
			page_size: perPage,
			status: VIEW_STATUS[view],
			...(sourceFilter ? { source_system: sourceFilter } : {}),
			...(sortByScale ? { sort: sortByScale } : {}),
			...(focusHoldId ? { id: focusHoldId } : {}),
			...(focusStreamIds?.length ? { stream_ids: focusStreamIds.join(',') } : {}),
			...(focusClassification ? { classification: focusClassification } : {}),
			...(estimatorFilter ? { estimator_declared: estimatorFilter === 'true' } : {}),
		});
		onPendingChange?.(result.pending);
		deferredCount = result.deferred;
		visibleSources = [
			...new Set(result.holds.map((h) => h.source_system).filter((s): s is string => s != null)),
		].sort();
		refreshThresholdCount();
		void refreshUndeclared();
		return { data: result.holds, total: result.total };
	}

	function refreshThresholdCount() {
		clearTimeout(thresholdTimer);
		thresholdTimer = setTimeout(async () => {
			try {
				const res = await listReplicateAudits({
					status: 'pending',
					...(sourceFilter ? { source_system: sourceFilter } : {}),
					max_mean_relative_delta: meanThresholdPct / 100,
					max_sd_relative_delta: sdThresholdPct / 100,
					page_size: 1,
				});
				thresholdCount = res.total;
			} catch {
				thresholdCount = null;
			}
		}, 250);
	}

	// Source systems store aggregate cells to 2 decimals; values display at that precision (full
	// precision in the tooltip) and a delta at or below the storage quantum is not colourable.
	const SOURCE_QUANTUM = 0.005;

	function fmtStat(v: number | null | undefined): string {
		if (v == null) return '–';
		return Number(v.toFixed(2)).toString();
	}

	function fullValue(v: number | null | undefined): string {
		return v == null ? 'No stored value' : String(v);
	}

	function fmt(v: number | null | undefined): string {
		if (v == null) return '–';
		return Number(v.toFixed(4)).toString();
	}

	function fmtPct(rel: number): string {
		const pct = rel * 100;
		if (pct >= 100) return `${Math.round(pct)}%`;
		return `${Number(pct.toFixed(pct < 1 ? 2 : 1))}%`;
	}

	// Severity bands over a relative delta: below 1% is the systematic-noise class, 1-10% warrants
	// a look, above 10% is a real disagreement. Length and the printed % carry the value; colour
	// only reinforces the band.
	type Band = 'low' | 'mid' | 'high';
	function band(rel: number): Band {
		if (rel < 0.01) return 'low';
		if (rel < 0.1) return 'mid';
		return 'high';
	}
	const BAR_FILL: Record<Band, string> = {
		low: 'bg-brand-muted',
		mid: 'bg-severity-warning-fill',
		high: 'bg-severity-alarm',
	};
	const DELTA_TEXT: Record<Band, string> = {
		low: 'text-brand-muted',
		mid: 'text-severity-warning-text',
		high: 'text-severity-alarm',
	};

	// A delta at or below the source's storage quantum is display noise, never coloured.
	function deltaClass(delta: number | null | undefined, rel: number): string {
		if (delta == null || Math.abs(delta) <= SOURCE_QUANTUM) return 'text-brand-muted';
		return DELTA_TEXT[band(rel)];
	}

	const CLASS_LABEL: Record<ReplicateAuditHold['classification'], string> = {
		n_mismatch: 'n mismatch',
		population_sd: 'population sd',
		stale_subset: 'stale aggregate',
		quantization: 'quantization',
		unexplained: 'unexplained',
	};
	const CLASS_STYLE: Record<ReplicateAuditHold['classification'], string> = {
		n_mismatch: 'bg-severity-alarm-soft text-severity-alarm',
		population_sd: 'bg-brand-bg text-brand-text',
		stale_subset: 'bg-brand-bg text-brand-text',
		quantization: 'bg-brand-bg text-brand-muted',
		unexplained: 'bg-severity-warning-soft text-severity-warning-text',
	};
	const CLASS_TIP: Record<ReplicateAuditHold['classification'], string> = {
		n_mismatch:
			'The source row has more non-null replicate cells than were stored here; a replicate was lost between the source and our ingest.',
		population_sd:
			"The source's sd matches the population formula (divisor n); ours uses the sample formula (divisor n-1).",
		stale_subset:
			"The source's stored avg/sd match a computation over a subset of the replicates; a replicate added later did not update the stored cells.",
		quantization: "The disagreement is at the scale of the source's 2-decimal storage.",
		unexplained: 'The disagreement does not match a known signature.',
	};

	// The population form of our own sample sd: s * sqrt((n-1)/n). What the source would have got
	// from the same replicates with divisor n.
	function populationSd(hold: ReplicateAuditHold): number | null {
		const { sd, n } = hold.computed;
		if (sd == null || n < 2) return null;
		return sd * Math.sqrt((n - 1) / n);
	}

	function causeText(hold: ReplicateAuditHold): string {
		if (!isStats(hold)) return KIND_TIP[hold.kind];
		const base = CLASS_TIP[hold.classification];
		if (hold.classification !== 'population_sd') return base;
		const pop = populationSd(hold);
		if (pop == null) return base;
		return `${base} Population sd of our replicates: ${fmtStat(pop)}; source ${fmtStat(hold.expected.sd)}.`;
	}

	function underThreshold(hold: ReplicateAuditHold): boolean {
		return (
			hold.status === 'pending' &&
			hold.mean_relative_delta <= meanThresholdPct / 100 &&
			hold.sd_relative_delta <= sdThresholdPct / 100
		);
	}

	function nMismatch(hold: ReplicateAuditHold): boolean {
		return hold.expected.n != null && hold.expected.n !== hold.computed.n;
	}

	// The stream cell names the slot when one resolves (paired streams and event findings both
	// carry site/parameter names), else the source's own display name; the raw source key stays
	// reachable via tooltip and detail dialog.
	function streamLabel(hold: ReplicateAuditHold): string {
		if (hold.site_name && hold.parameter_name) {
			return `${hold.site_name} · ${hold.parameter_name}`;
		}
		return hold.source_name ?? hold.source_key ?? 'unknown source';
	}

	// Kinds beyond the replicate-statistics disagreement: reconciliation holds (stream-keyed) and
	// event-audit findings (slot-keyed, stream_id null).
	const KIND_LABEL: Record<HoldKind, string> = {
		replicate_stats: holdKindLabel('replicate_stats'),
		source_modified: holdKindLabel('source_modified'),
		brake_fired: holdKindLabel('brake_fired'),
		missing_output: holdKindLabel('missing_output'),
		stale_output: holdKindLabel('stale_output'),
		curve_claim_stripped: holdKindLabel('curve_claim_stripped'),
	};
	const KIND_STYLE: Record<HoldKind, string> = {
		replicate_stats: 'bg-brand-bg text-brand-text',
		source_modified: 'bg-severity-warning-soft text-severity-warning-text',
		brake_fired: 'bg-severity-alarm-soft text-severity-alarm',
		missing_output: 'bg-severity-warning-soft text-severity-warning-text',
		stale_output: 'bg-severity-warning-soft text-severity-warning-text',
		curve_claim_stripped: 'bg-severity-warning-soft text-severity-warning-text',
	};
	const KIND_TIP: Record<HoldKind, string> = {
		replicate_stats:
			"The group's recomputed statistics disagree with the source's stored avg/sd.",
		source_modified:
			'The source changed or withdrew a reading that carries curation (a flag, a hand-picked curve, or a labelled sample). The value change applied; the curation and servedness did not move without this review.',
		brake_fired:
			'A reconciliation pass wanted to change or withdraw more of this stream than the brake allows. Its new rows applied; the reshape did not. Acknowledging admits exactly one braked-scale pass on the next sync cycle.',
		missing_output:
			"The tool's declared inputs exist at this visit but its output was never saved.",
		stale_output:
			'The stored output disagrees with a recompute under the same pinned script version, typically after an upstream correction.',
		curve_claim_stripped:
			"The source named a standard curve this reading cannot carry (fitted on a different instrument, or not a spot measurement). The values were stored uncorrected; the claim is recorded here. Fix the curve's instrument or the stream's, then re-sync to apply the correction.",
	};

	function isStats(hold: ReplicateAuditHold): boolean {
		return !hold.kind || hold.kind === 'replicate_stats';
	}

	const STATUS_LABEL: Record<ReplicateAuditHold['status'], string> = {
		pending: 'Needs review',
		deferred: 'Awaiting pairing',
		acknowledged: 'Reviewed',
		remediated: 'Replicates flagged',
		use_portal: 'Legacy: source value applied',
		use_manual: 'Legacy: source value applied',
		consumed: 'Legacy: source value applied',
		superseded: 'Cleared at source',
	};

	function statusVariant(
		status: ReplicateAuditHold['status'],
	): 'warning' | 'ok' | 'muted' | 'accent' | 'default' {
		switch (status) {
			case 'pending': return 'warning';
			case 'deferred': return 'muted';
			case 'acknowledged': return 'ok';
			case 'remediated': return 'accent';
			case 'use_portal': return 'ok';
			case 'use_manual': return 'ok';
			case 'consumed': return 'ok';
			default: return 'default';
		}
	}

	async function handleBulkThreshold(ctx: { reload: () => Promise<void> }) {
		acknowledging = true;
		try {
			const res = await acknowledgeReplicateAuditsBulk({
				...(sourceFilter ? { source_system: sourceFilter } : {}),
				max_mean_relative_delta: meanThresholdPct / 100,
				max_sd_relative_delta: sdThresholdPct / 100,
			});
			const skipped = res.skipped_undeclared_estimator ?? 0;
			toastStore.success(
				`Marked ${res.acknowledged} hold${res.acknowledged === 1 ? '' : 's'} reviewed under x̄ ≤ ${meanThresholdPct}% and s ≤ ${sdThresholdPct}%` +
					(skipped > 0
						? `; ${skipped} left pending, awaiting a standard-deviation formula for their parameter`
						: ''),
			);
			await ctx.reload();
			await refreshUndeclared();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to mark reviewed');
		} finally {
			acknowledging = false;
		}
	}

	// Per-open resolution state: which replicate indexes to flag, and why.
	let selectedReplicates = $state<Set<number>>(new Set());
	let flagReason = $state('');
	// The hold whose detail is open, so the preview below can follow the selection.
	let openHold = $state<ReplicateAuditHold | null>(null);
	// What the statistics become under the change being considered (the selected replicates
	// flagged, or the chosen divisor declared), read before the write rather than after it.
	let preview = $state<SamplePreviewResponse | null>(null);
	let previewError = $state<string | null>(null);
	let previewSeq = 0;

	$effect(() => {
		const hold = openHold;
		const exclude = [...selectedReplicates].sort((a, b) => a - b);
		const estimator = hold && needsDeclaration(hold) ? declareChoice : undefined;
		preview = null;
		previewError = null;
		if (!hold?.stream_id || hold.status !== 'pending' || !isStats(hold)) return;
		if (exclude.length === 0 && !estimator) return;
		const seq = ++previewSeq;
		previewSample({
			stream_id: hold.stream_id,
			time: hold.group_time,
			hold_id: hold.id,
			...(exclude.length ? { exclude_replicate_indexes: exclude } : {}),
			...(estimator ? { estimator } : {}),
		})
			.then((p) => {
				if (seq === previewSeq) preview = p;
			})
			.catch((e) => {
				if (seq === previewSeq) previewError = e instanceof Error ? e.message : 'Preview failed';
			});
	});

	function previewTitle(): string {
		const exclude = [...selectedReplicates].sort((a, b) => a - b);
		const parts: string[] = [];
		if (exclude.length) parts.push(`after flagging replicate${exclude.length === 1 ? '' : 's'} ${exclude.join(', ')}`);
		if (preview && preview.proposed.sd_estimator !== preview.current.sd_estimator) {
			parts.push(`under the ${estimatorLabel(preview.proposed.sd_estimator)} formula`);
		}
		return parts.length ? `Statistics ${parts.join(' and ')}` : 'Statistics';
	}

	// The confirm's own rows for a flag: what the numbers become, from the same preview.
	function flagPreviewRows(): { label: string; value: string | number }[] {
		if (!preview) return [];
		const rows = [
			{ label: 'Mean after', value: `${fmtStat(preview.current.mean)} to ${fmtStat(preview.proposed.mean)}` },
			{
				label: `${sdRowLabel(preview.proposed.sd_estimator)} after`,
				value: `${fmtStat(preview.current.sd)} to ${fmtStat(preview.proposed.sd)}`,
			},
		];
		if (preview.hold) {
			rows.push({ label: "Meets the source's cells", value: preview.hold.meets_after ? 'yes' : 'no' });
		}
		return rows;
	}

	function toggleReplicate(idx: number) {
		const next = new Set(selectedReplicates);
		if (next.has(idx)) next.delete(idx);
		else next.add(idx);
		selectedReplicates = next;
	}

	async function refreshUndeclared() {
		try {
			undeclared = (await listUndeclaredSdEstimators()).slots;
		} catch {
			// Listing may be denied; the per-hold actions still work from the hold itself.
			undeclared = [];
		}
	}

	// The slot this hold sits on, when it is one of the undeclared ones. Its counts are what the
	// confirm quotes, so what the operator is told and what the declaration does come from the
	// same numbers.
	function undeclaredSlot(hold: ReplicateAuditHold): UndeclaredEstimatorSlot | null {
		return (
			undeclared.find(
				(s) => s.site_name === hold.site_name && s.parameter_name === hold.parameter_name,
			) ?? null
		);
	}

	// A hold the resolution gate blocks: the divisor explains it and the parameter has not said
	// which one it publishes, so accepting would file that decision without anyone making it.
	function needsDeclaration(hold: ReplicateAuditHold): boolean {
		return (
			hold.kind === 'replicate_stats' &&
			hold.classification === 'population_sd' &&
			hold.status === 'pending' &&
			undeclaredSlot(hold) !== null
		);
	}

	async function handleDeclare(
		hold: ReplicateAuditHold,
		scope: 'slot' | 'instant',
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		acknowledging = true;
		try {
			const res = await resolveReplicateAudit(hold.id, {
				mode: 'estimator',
				estimator: declareChoice,
				scope,
			});
			toastStore.success(
				scope === 'slot'
					? `${hold.site_name} / ${hold.parameter_name} now publishes the ${estimatorLabel(declareChoice)} standard deviation; ${res.samples_affected ?? 0} sample${res.samples_affected === 1 ? '' : 's'} recomputing`
					: `This collection group now uses the ${estimatorLabel(declareChoice)} standard deviation`,
			);
			ctx.close();
			await ctx.reload();
			await refreshUndeclared();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to declare');
		} finally {
			acknowledging = false;
		}
	}

	async function handleAccept(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		acknowledging = true;
		try {
			await resolveReplicateAudit(hold.id, { mode: 'ours' });
			toastStore.success('Marked reviewed: the statistics computed here stand');
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to mark reviewed');
		} finally {
			acknowledging = false;
		}
	}

	async function handleFlag(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		acknowledging = true;
		try {
			const indexes = [...selectedReplicates].sort((a, b) => a - b);
			await resolveReplicateAudit(hold.id, {
				mode: 'flag',
				replicate_indexes: indexes,
				...(flagReason.trim() ? { reason: flagReason.trim() } : {}),
			});
			toastStore.success(
				`Flagged ${indexes.length} replicate${indexes.length === 1 ? '' : 's'}; statistics recomputed from the remaining ${hold.computed.n - indexes.length}`,
			);
			selectedReplicates = new Set();
			flagReason = '';
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to flag');
		} finally {
			acknowledging = false;
		}
	}

	async function handleReopen(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		acknowledging = true;
		try {
			await reopenReplicateAudit(hold.id);
			toastStore.success('Replicates unflagged; the hold is back in review');
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to reopen');
		} finally {
			acknowledging = false;
		}
	}

	// Acknowledge one non-statistics hold: for brake_fired this IS the release (one braked-scale
	// pass is admitted, then the hold moves to remediated); for the others it records review.
	let recomputing = $state(false);
	// Recompute the visit a finding names: the visit standing at (site, instant) is adopted, its
	// chain runs as a tracked job, and the finding closes when the run rewrites the output.
	async function handleRecomputeVisit(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		if (!hold.site_id) return;
		recomputing = true;
		try {
			const visit = await stageCollectionEvent({ site_id: hold.site_id, collected_at: hold.group_time });
			const r = await recomputeCollectionEvent(visit.id);
			if (r.job_id) {
				const job = await pollJob(r.job_id);
				if (job.status !== 'completed') {
					toastStore.error(job.error_message ?? 'The recompute did not complete');
					return;
				}
				const counts = (job.detail?.counts ?? {}) as Record<string, number>;
				toastStore.success(
					`Recomputed: ${counts.tools_run ?? 0} run, ${counts.tools_unchanged ?? 0} unchanged, ${counts.findings_closed ?? 0} finding${(counts.findings_closed ?? 0) === 1 ? '' : 's'} closed`,
				);
			}
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to recompute the visit');
		} finally {
			recomputing = false;
		}
	}

	async function handleAcknowledgeHold(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
		successMessage: string,
	) {
		acknowledging = true;
		try {
			await acknowledgeReplicateAudit(hold.id);
			toastStore.success(successMessage);
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to acknowledge');
		} finally {
			acknowledging = false;
		}
	}

	async function handleAcknowledgeStream(hold: ReplicateAuditHold, ctx: { close: () => void; reload: () => Promise<void> }) {
		if (!hold.stream_id) return;
		acknowledging = true;
		try {
			const res = await acknowledgeReplicateAuditsBulk({ stream_id: hold.stream_id });
			const skipped = res.skipped_undeclared_estimator ?? 0;
			toastStore.success(
				`Marked ${res.acknowledged} hold${res.acknowledged === 1 ? '' : 's'} reviewed for ${streamLabel(hold)}` +
					(skipped > 0
						? `; ${skipped} left pending, awaiting a standard-deviation formula for the parameter`
						: ''),
			);
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to mark reviewed');
		} finally {
			acknowledging = false;
		}
	}

	function resolutionIndexes(hold: ReplicateAuditHold): number[] {
		return hold.resolution?.replicate_indexes ?? [];
	}

	// What Reopen undoes, as labelled facts: the declaration it reverts or the flags it lifts.
	function reopenRows(hold: ReplicateAuditHold): { label: string; value: string | number }[] {
		const r = hold.resolution;
		if (r?.action === 'declare_estimator') {
			if (r.scope === 'slot') {
				return [
					{ label: 'Parameter', value: `${hold.site_name} / ${hold.parameter_name}` },
					{ label: 'Sd formula reverts to', value: r.previous_estimator ? estimatorLabel(r.previous_estimator) : 'not declared' },
					{ label: 'Samples recomputed', value: 'all at the parameter' },
				];
			}
			return [{ label: 'This group reverts to', value: "the parameter's setting" }];
		}
		const indexes = resolutionIndexes(hold);
		return [
			{ label: 'Replicates unflagged', value: indexes.join(', ') || 'none' },
			{ label: 'Statistics recompute from', value: `${hold.computed.n} replicates` },
		];
	}

	// The group's values with the replicate index each is stored at. A hold recorded before the
	// index travelled with the value holds bare numbers, and no position in that array names an
	// index, so it reads as null.
	function heldValues(hold: ReplicateAuditHold): { index: number | null; value: number }[] {
		return (hold.computed.values ?? []).map((v) =>
			typeof v === 'number' ? { index: null, value: v } : { index: v.index, value: v.value },
		);
	}

	function isFlaggable(hold: ReplicateAuditHold): boolean {
		const values = heldValues(hold);
		return values.length > 0 && values.every((v) => v.index !== null);
	}
</script>

{#snippet deltaCell(delta: number | null | undefined, rel: number)}
	<td class="px-3 py-2 text-right" title="Disagreement relative to the mean magnitude: {fmtPct(rel)} (bar capped at {METER_CAP_PCT}%)">
		<div class="font-mono text-xs {deltaClass(delta, rel)}" title={fullValue(delta)}>{fmt(delta)}</div>
		<div class="flex items-center justify-end gap-1 mt-0.5">
			<div class="w-14 h-1 rounded-sm bg-brand-bg border border-brand-divider overflow-hidden shrink-0">
				<div
					class="h-full {BAR_FILL[band(rel)]}"
					style="width: {Math.min((rel * 100) / METER_CAP_PCT, 1) * 100}%"
				></div>
			</div>
			<span class="font-mono text-numeric text-brand-muted w-10 text-right">{fmtPct(rel)}</span>
		</div>
	</td>
{/snippet}

<EventPanel
	load={loadPage}
	perPage={PER_PAGE}
	colCount={12}
	rowClass={(hold) => (underThreshold(hold) ? 'bg-severity-ok-soft' : '')}
	emptyText={view === 'review' ? 'Nothing needs review' : view === 'resolved' ? 'No resolved holds' : 'No holds awaiting pairing'}
	detailTitle="Replicate Audit Hold"
	detailMaxWidth="md"
	onOpenDetail={(hold) => { openHold = hold; selectedReplicates = new Set(); flagReason = ''; }}
>
	{#snippet filterBar({ reload })}
		<div class="flex gap-1 flex-wrap">
			{#each [
				{ key: 'review' as View, label: 'Needs review' },
				{ key: 'resolved' as View, label: 'Resolved' },
				...(deferredCount > 0 || view === 'deferred'
					? [{ key: 'deferred' as View, label: `Awaiting pairing (${deferredCount})` }]
					: []),
			] as v}
				<button
					onclick={() => { view = v.key; reload(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {view === v.key ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{v.label}</button>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<button
				onclick={() => { sortByScale = sortByScale === 'relative_delta_desc' ? 'relative_delta_asc' : 'relative_delta_desc'; reload(); }}
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface cursor-pointer {sortByScale ? 'text-brand-primary' : 'text-brand-muted'}"
				title="Sort by overall disagreement size (max of x̄ and s) across all pages"
			>Δ size {sortByScale === 'relative_delta_desc' ? '▾' : sortByScale === 'relative_delta_asc' ? '▴' : '↕'}</button>
			<select
				bind:value={sourceFilter}
				onchange={() => { issuedCommand = null; reload(); }}
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
				title="Filter holds by source system; the resync button targets the selected source"
			>
				<option value="">All sources</option>
				{#each sourceOptions as s}
					<option value={s}>{s}</option>
				{/each}
			</select>
			<select
				bind:value={focusClassification}
				onchange={() => reload()}
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
				title="Filter by disagreement signature. Only these two are filterable server-side, so a filtered page counts honestly."
			>
				<option value="">Any disagreement</option>
				<option value="population_sd">Matching the population divisor (n)</option>
				<option value="not_population_sd">Matching neither divisor</option>
			</select>
			<select
				bind:value={estimatorFilter}
				onchange={() => reload()}
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
				title="Whether the hold's slot has declared which standard-deviation formula it publishes"
			>
				<option value="">Any sd formula</option>
				<option value="true">Formula declared</option>
				<option value="false">Formula not declared</option>
			</select>
			{#if sourceFilter}
				<span title={syncService ? `Issue a full sync to ${syncService.instance_id} so ${sourceFilter} re-sends its data without waiting for the cycle` : `No active sync service matches ${sourceFilter}`}>
					<Button size="sm" disabled={!syncService || requestingSync} onclick={requestSyncNow}>
						{requestingSync ? 'Requesting…' : `Resync ${sourceFilter}`}
					</Button>
				</span>
				{#if issuedCommand}
					{@const chip = commandChip(issuedCommand)}
					<span class="px-2 py-0.5 rounded-full text-xs {chip.alarm ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted'}">
						{chip.label}
					</span>
				{/if}
			{/if}
		</div>
		<div class="flex items-center gap-2 ml-auto">
			<div class="space-y-0.5">
				<div class="flex items-center gap-2">
					<label for="audit-threshold-mean" class="w-14 text-right text-xs text-brand-muted whitespace-nowrap">
						x̄ ≤ <span class="font-mono text-brand-text">{meanThresholdPct}%</span>
					</label>
					<input
						id="audit-threshold-mean"
						type="range"
						min="0.25"
						max={METER_CAP_PCT}
						step="0.25"
						bind:value={meanThresholdPct}
						oninput={refreshThresholdCount}
						class="w-32 accent-brand-primary"
					/>
				</div>
				<div class="flex items-center gap-2">
					<label for="audit-threshold-sd" class="w-14 text-right text-xs text-brand-muted whitespace-nowrap">
						s ≤ <span class="font-mono text-brand-text">{sdThresholdPct}%</span>
					</label>
					<input
						id="audit-threshold-sd"
						type="range"
						min="0.25"
						max={METER_CAP_PCT}
						step="0.25"
						bind:value={sdThresholdPct}
						oninput={refreshThresholdCount}
						class="w-32 accent-brand-primary"
					/>
				</div>
			</div>
			<ConfirmPopover
				message="Mark every pending hold under the threshold reviewed? No value changes: the statistics computed here stand, and each instant gets an audit annotation naming both numbers."
				confirmLabel="Mark {thresholdCount ?? ''} reviewed"
				confirmVariant="primary"
				onconfirm={() => handleBulkThreshold({ reload })}
			>
				{#snippet detail()}
					<CountList
						rows={[
							{ label: 'Holds marked reviewed', value: thresholdCount ?? '…' },
							{ label: 'Mean disagreement at most', value: `${meanThresholdPct}%` },
							{ label: 'Sd disagreement at most', value: `${sdThresholdPct}%` },
							{ label: 'Parameters without an sd formula, holds skipped', value: undeclared.length },
						]}
					/>
				{/snippet}
				<Button disabled={acknowledging || !thresholdCount}>
					Mark {thresholdCount ?? '…'} reviewed under threshold
				</Button>
			</ConfirmPopover>
		</div>
		<Button onclick={reload}>Refresh</Button>
		{#if focusHoldId}
			<div class="w-full flex items-center gap-2 text-xs">
				<span class="px-2 py-0.5 rounded-full bg-brand-bg text-brand-text">One hold, opened from its measurement</span>
				<button
					onclick={() => { focusHoldId = null; reload(); }}
					class="bg-transparent border-none p-0 cursor-pointer text-brand-primary underline-offset-2 hover:underline"
				>Show every hold</button>
			</div>
		{/if}
		{#if focusStreamIds}
			<div class="w-full flex items-center gap-2 text-xs">
				<span class="px-2 py-0.5 rounded-full bg-brand-bg text-brand-text">
					{focusStreamIds.length} selected stream{focusStreamIds.length === 1 ? '' : 's'}{initialFocusLabel
						? ` · ${initialFocusLabel}`
						: ''}
				</span>
				<button
					onclick={() => { focusStreamIds = null; reload(); }}
					class="bg-transparent border-none p-0 cursor-pointer text-brand-primary underline-offset-2 hover:underline"
				>Show every stream</button>
			</div>
		{/if}
		{#if view === 'deferred'}
			<p class="w-full text-xs text-brand-muted">
				These streams are not paired to a site yet, so their disagreements are recorded but not yet
				decidable. Pairing moves them into Needs review.
			</p>
		{/if}
		{#if undeclared.length > 0}
			{@const gated = undeclared.reduce((n, s) => n + s.population_signature_holds, 0)}
			<div class="w-full rounded-md border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-xs text-severity-warning-text space-y-1">
				<p>
					<strong>{undeclared.length} parameter{undeclared.length === 1 ? '' : 's'}</strong>
					serve{undeclared.length === 1 ? 's' : ''} replicate statistics without a declared
					standard-deviation formula.
					{#if gated > 0}
						{gated} hold{gated === 1 ? '' : 's'} here disagree only by that divisor and cannot be
						accepted until the formula is chosen.
					{/if}
				</p>
				<ul class="space-y-0.5">
					{#each undeclared.slice(0, 6) as slot}
						<li>
							<span class="font-semibold">{slot.site_name} / {slot.parameter_name}</span>
							<span class="text-brand-muted">
								({slot.undeclared_samples} sample{slot.undeclared_samples === 1 ? '' : 's'} on the
								sample formula (n-1){slot.population_signature_holds > 0
									? `, ${slot.population_signature_holds} hold${slot.population_signature_holds === 1 ? '' : 's'} matching the population divisor`
									: ''}{slot.source_reports_sd ? ', source ships its own sd' : ''}
							</span>
						</li>
					{/each}
					{#if undeclared.length > 6}
						<li class="text-brand-muted">and {undeclared.length - 6} more</li>
					{/if}
				</ul>
				<p class="text-brand-muted">
					Open a hold below to read the evidence and declare the formula, for the parameter or
					for one instant.
				</p>
			</div>
		{/if}
		<p class="w-full text-xs text-brand-muted">
			The source's average and sd are never applied: what is served is always computed from the
			stored replicates. A review decides only whether an input replicate is wrong (flag it) or the
			standard-deviation divisor is different (declare it).
		</p>
		<details class="w-full text-xs text-brand-muted">
			<summary class="cursor-pointer text-brand-primary">What does ruling on a hold change?</summary>
			<div class="mt-1.5 space-y-1.5 max-w-4xl">
				<p>
					Every replicate the source sent is stored and served whether or not you rule. A hold only
					records that the source's own avg/sd cell disagrees with the mean/sd computed here, so
					leaving one open changes no served value, alarm, export or rollup. Each sync cycle
					rewrites the same row rather than adding one; a hold closes itself only when the source
					comes to agree (it then reads <em>Superseded</em>).
				</p>
				<p>
					<strong>Mark reviewed</strong> changes no value. It records that the computed statistics
					were looked at and stand, and writes an audit annotation at that instant, which is drawn
					on the parameter's chart and included in the site's annotations CSV.
				</p>
				<p>
					<strong>Flag replicates</strong> does change data: the replicates you name are flagged, so
					the mean and sd recompute over the rest and the served value, exports and rollups follow.
					Reopening the hold unflags them again.
				</p>
				<p>
					<strong>Declaring the sd formula</strong> is asked for when the source's sd matches the
					population divisor and the parameter has not declared one. The sources used both formulas
					over the years, so it cannot be inferred from the data; flag a replicate instead if the
					real fault is a value rather than the divisor.
				</p>
			</div>
		</details>
	{/snippet}

	{#snippet head()}
		<th class="text-left px-4 py-2 font-semibold">Stream</th>
		<th class="text-left px-4 py-2 font-semibold">Instant</th>
		<th class="text-right px-4 py-2 font-semibold" title="Replicate count: source (non-null cells) / ours (unflagged stored replicates)">n</th>
		<th class="text-right px-3 py-2 font-semibold">Mean source</th>
		<th class="text-right px-3 py-2 font-semibold" title="AVG(COALESCE(calibrated_value, raw_value)) over the unflagged replicates">Mean ours</th>
		<th class="text-right px-3 py-2 font-semibold">Δ mean</th>
		<th class="text-right px-3 py-2 font-semibold">SD source</th>
		<th class="text-right px-3 py-2 font-semibold" title="The sd computed here under the divisor the parameter declares (sample, n-1, unless it declares population); each value's tooltip names its formula">SD ours</th>
		<th class="text-right px-3 py-2 font-semibold">Δ sd</th>
		<th class="text-left px-3 py-2 font-semibold">Possible cause</th>
		<th class="text-left px-4 py-2 font-semibold">Status</th>
		<th class="text-left px-4 py-2 font-semibold">Age</th>
	{/snippet}

	{#snippet row(hold)}
		<td class="px-4 py-2 text-xs" title={hold.source_key ?? undefined}>
			<div class="flex items-center gap-1.5">
				<span class="px-1.5 py-0.5 rounded bg-brand-bg font-mono text-[10px] text-brand-muted shrink-0">{hold.source_system ?? (hold.tool ? `tool ${hold.tool}` : 'audit')}</span>
				<span class="truncate max-w-56">{streamLabel(hold)}</span>
			</div>
		</td>
		<td class="px-4 py-2 text-xs">{formatDateTime(hold.group_time)}</td>
		<td class="px-4 py-2 text-right font-mono text-xs" title="Replicate count: source / ours">
			{#if nMismatch(hold)}
				<span class="px-1 py-0.5 rounded bg-severity-alarm-soft text-severity-alarm" title={CLASS_TIP.n_mismatch}>{hold.expected.n} / {hold.computed.n}</span>
			{:else}
				{hold.expected.n ?? '–'} / {hold.computed.n}
			{/if}
		</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.expected.mean)}>{fmtStat(hold.expected.mean)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.computed.mean)}>{fmtStat(hold.computed.mean)}</td>
		{@render deltaCell(hold.delta.mean, hold.mean_relative_delta)}
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.expected.sd)}>{fmtStat(hold.expected.sd)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title="{fullValue(hold.computed.sd)}. {sdFormulaTitle(hold.sd_estimator)}">{fmtStat(hold.computed.sd)}</td>
		{@render deltaCell(hold.delta.sd, hold.sd_relative_delta)}
		<td class="px-3 py-2">
			{#if isStats(hold)}
				<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {CLASS_STYLE[hold.classification]}" title={causeText(hold)}>
					{CLASS_LABEL[hold.classification]}
				</span>
			{:else}
				<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {KIND_STYLE[hold.kind]}" title={KIND_TIP[hold.kind]}>
					{KIND_LABEL[hold.kind]}
				</span>
			{/if}
		</td>
		<td class="px-4 py-2">
			<Badge variant={statusVariant(hold.status)}>{STATUS_LABEL[hold.status]}</Badge>
		</td>
		<td class="px-4 py-2 text-xs text-brand-muted">{formatRelativeTime(hold.created_at)}</td>
	{/snippet}

	{#snippet detail(hold)}
		<div class="space-y-4 text-sm">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<span class="text-brand-muted text-xs">Stream</span>
					<p>{streamLabel(hold)}</p>
					<p class="font-mono text-xs text-brand-muted">{hold.source_key}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Source system</span>
					<p>{hold.source_system ?? '-'}</p>
				</div>
				{#if hold.tool}
					<div>
						<span class="text-brand-muted text-xs">Tool</span>
						<p>{hold.tool}</p>
					</div>
				{/if}
				<div>
					<span class="text-brand-muted text-xs">Instant</span>
					<p>{formatDateTime(hold.group_time)}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Status</span>
					<p><Badge variant={statusVariant(hold.status)}>{STATUS_LABEL[hold.status]}</Badge></p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Possible cause</span>
					<p class="text-xs">{causeText(hold)}</p>
				</div>
				{#if hold.acknowledged_at}
					<div>
						<span class="text-brand-muted text-xs">Resolved</span>
						<p>{formatDateTime(hold.acknowledged_at)}{hold.acknowledged_by ? ` by ${hold.acknowledged_by}` : ''}</p>
					</div>
				{/if}
			</div>

			{#if needsDeclaration(hold)}
				{@const pop = populationSd(hold)}
				<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft p-3 text-xs text-severity-warning-text space-y-2">
					<p>
						<strong>This can't be accepted yet.</strong>
						The source's sd ({fmtStat(hold.expected.sd)}) is this group's sd under the
						population formula (divisor n){pop != null ? `, ${fmtStat(pop)}` : ''}; ours
						({fmtStat(hold.computed.sd)}) uses the sample formula (divisor n-1).
						<strong>{hold.site_name} / {hold.parameter_name}</strong> has not declared which one
						it publishes, so accepting would leave that unrecorded.
					</p>
					<div class="flex items-center gap-3">
						<span class="font-semibold">Publish the standard deviation as</span>
						{#each [
							{ value: 'population' as SdEstimator, label: 'Population (n)' },
							{ value: 'sample' as SdEstimator, label: 'Sample (n-1)' },
						] as choice}
							<label class="flex items-center gap-1.5 cursor-pointer">
								<input type="radio" value={choice.value} bind:group={declareChoice} />
								{choice.label}
							</label>
						{/each}
					</div>
				</div>
			{/if}

			{#if !isStats(hold)}
				<div class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-2">
					{#if hold.kind === 'stale_output' || hold.kind === 'missing_output'}
						<div class="grid grid-cols-2 gap-3">
							<div>
								<span class="text-brand-muted block mb-1">Recomputed (expected)</span>
								<pre class="font-mono whitespace-pre-wrap break-all">{JSON.stringify(hold.expected, null, 1)}</pre>
							</div>
							<div>
								<span class="text-brand-muted block mb-1">Stored</span>
								<pre class="font-mono whitespace-pre-wrap break-all">{JSON.stringify(hold.computed, null, 1)}</pre>
							</div>
						</div>
					{:else}
						<div>
							<span class="text-brand-muted block mb-1">What the pass recorded</span>
							<pre class="font-mono whitespace-pre-wrap break-all">{JSON.stringify(hold.expected, null, 1)}</pre>
						</div>
						{#if hold.computed && Object.keys(hold.computed).length > 0}
							<div>
								<span class="text-brand-muted block mb-1">Stored state</span>
								<pre class="font-mono whitespace-pre-wrap break-all">{JSON.stringify(hold.computed, null, 1)}</pre>
							</div>
						{/if}
					{/if}
				</div>
			{:else}
			<div class="rounded-md border border-brand-divider overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-3 py-1.5 font-semibold"></th>
							<th class="text-right px-3 py-1.5 font-semibold">Source (expected)</th>
							<th class="text-right px-3 py-1.5 font-semibold">Computed</th>
							<th class="text-right px-3 py-1.5 font-semibold">Δ</th>
						</tr>
					</thead>
					<tbody>
						<tr class="border-b border-brand-divider">
							<td class="px-3 py-1.5 text-brand-muted" title="AVG(COALESCE(calibrated_value, raw_value)) over the unflagged replicates">Mean</td>
							<td class="px-3 py-1.5 text-right font-mono" title={fullValue(hold.expected.mean)}>{fmtStat(hold.expected.mean)}</td>
							<td class="px-3 py-1.5 text-right font-mono" title={fullValue(hold.computed.mean)}>{fmtStat(hold.computed.mean)}</td>
							<td class="px-3 py-1.5 text-right font-mono {deltaClass(hold.delta.mean, hold.mean_relative_delta) === 'text-brand-muted' ? 'text-brand-muted' : 'text-severity-warning-text bg-severity-warning-soft'}" title={fullValue(hold.delta.mean)}>{fmt(hold.delta.mean)}</td>
						</tr>
						<tr class="border-b border-brand-divider">
							<td class="px-3 py-1.5 text-brand-muted" title={sdFormulaTitle(hold.sd_estimator)}>{sdRowLabel(hold.sd_estimator)}</td>
							<td class="px-3 py-1.5 text-right font-mono" title={fullValue(hold.expected.sd)}>{fmtStat(hold.expected.sd)}</td>
							<td class="px-3 py-1.5 text-right font-mono" title={fullValue(hold.computed.sd)}>{fmtStat(hold.computed.sd)}</td>
							<td class="px-3 py-1.5 text-right font-mono {deltaClass(hold.delta.sd, hold.sd_relative_delta) === 'text-brand-muted' ? 'text-brand-muted' : 'text-severity-warning-text bg-severity-warning-soft'}" title={fullValue(hold.delta.sd)}>{fmt(hold.delta.sd)}</td>
						</tr>
						<tr>
							<td class="px-3 py-1.5 text-brand-muted" title="Unflagged replicate count">n</td>
							<td class="px-3 py-1.5 text-right font-mono {nMismatch(hold) ? 'text-severity-alarm bg-severity-alarm-soft' : 'text-brand-muted'}">{hold.expected.n ?? '–'}</td>
							<td class="px-3 py-1.5 text-right font-mono {nMismatch(hold) ? 'text-severity-alarm bg-severity-alarm-soft' : ''}">{hold.computed.n}</td>
							<td class="px-3 py-1.5 text-right font-mono {hold.delta.n ? 'text-severity-alarm bg-severity-alarm-soft' : 'text-brand-muted'}">{fmt(hold.delta.n)}</td>
						</tr>
					</tbody>
				</table>
			</div>

			{#if hold.computed.values?.length}
				{@const values = heldValues(hold)}
				{@const flaggable = isFlaggable(hold)}
				<div>
					<span class="text-brand-muted text-xs block mb-1">
						{hold.status === 'pending' && flaggable
							? 'Replicates (select to flag; flagged replicates are excluded from the mean and sd, which recompute from the rest)'
							: `Replicate values (${values.length})`}
					</span>
					{#if hold.status === 'pending' && flaggable}
						<div class="space-y-1">
							{#each values as v}
								<label class="flex items-center gap-2 text-xs cursor-pointer">
									<input
										type="checkbox"
										checked={selectedReplicates.has(v.index!)}
										onchange={() => toggleReplicate(v.index!)}
										class="accent-brand-primary"
									/>
									<span class="font-mono text-brand-muted">replicate {v.index}</span>
									<span class="font-mono" title={String(v.value)}>{fmt(v.value)}</span>
								</label>
							{/each}
							{#if selectedReplicates.size > 0}
								<input
									type="text"
									bind:value={flagReason}
									placeholder="Reason (optional)"
									class="mt-1 w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
								/>
							{/if}
						</div>
					{:else}
						<div class="flex flex-wrap gap-1">
							{#each values as v}
								{@const wasFlagged = v.index !== null && resolutionIndexes(hold).includes(v.index)}
								<span
									class="px-1.5 py-0.5 rounded font-mono text-xs {wasFlagged ? 'bg-severity-warning-soft text-severity-warning-text line-through' : 'bg-brand-bg'}"
									title={wasFlagged ? 'Flagged by this resolution' : String(v.value)}
								>{fmt(v.value)}</span>
							{/each}
						</div>
						{#if hold.status === 'pending'}
							<p class="mt-1 text-xs text-brand-muted">
								This hold was recorded without replicate indexes, so a replicate cannot be flagged
								from here. Marking it reviewed is still available.
							</p>
						{/if}
					{/if}
				</div>
			{/if}

			{#if preview || previewError}
				<div data-testid="sample-preview" class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-2">
					{#if previewError}
						<p class="text-severity-alarm">{previewError}</p>
					{:else if preview}
						<p class="font-semibold">{previewTitle()}</p>
						<table class="w-full">
							<thead class="text-brand-muted">
								<tr>
									<th class="text-left font-medium py-0.5">Statistic</th>
									<th class="text-right font-medium py-0.5">Now</th>
									<th class="text-right font-medium py-0.5">After</th>
									<th class="text-right font-medium py-0.5">Change</th>
								</tr>
							</thead>
							<tbody class="font-mono">
								<tr>
									<td class="font-sans text-brand-muted py-0.5">Mean</td>
									<td class="text-right" title={fullValue(preview.current.mean)}>{fmtStat(preview.current.mean)}</td>
									<td class="text-right" title={fullValue(preview.proposed.mean)}>{fmtStat(preview.proposed.mean)}</td>
									<td class="text-right" title={fullValue(preview.delta.mean)}>{fmt(preview.delta.mean)}</td>
								</tr>
								<tr>
									<td class="font-sans text-brand-muted py-0.5" title={sdFormulaTitle(preview.proposed.sd_estimator)}>
										{sdRowLabel(preview.current.sd_estimator)}{preview.proposed.sd_estimator !== preview.current.sd_estimator ? ` to ${sdRowLabel(preview.proposed.sd_estimator)}` : ''}
									</td>
									<td class="text-right" title={fullValue(preview.current.sd)}>{fmtStat(preview.current.sd)}</td>
									<td class="text-right" title={fullValue(preview.proposed.sd)}>{fmtStat(preview.proposed.sd)}</td>
									<td class="text-right" title={fullValue(preview.delta.sd)}>{fmt(preview.delta.sd)}</td>
								</tr>
								<tr>
									<td class="font-sans text-brand-muted py-0.5">n</td>
									<td class="text-right">{preview.current.n}</td>
									<td class="text-right">{preview.proposed.n}</td>
									<td class="text-right">{preview.delta.n}</td>
								</tr>
							</tbody>
						</table>
						{#if preview.hold}
							<p class={preview.hold.meets_after ? 'text-severity-ok-text' : 'text-severity-warning-text'}>
								{preview.hold.meets_after
									? "Meets the source's cells within the audit tolerances"
									: "Does not meet the source's cells"}
								(mean {preview.hold.mean_agrees ? 'agrees' : 'differs'}, sd {preview.hold.sd_agrees ? 'agrees' : 'differs'}{preview.hold.expected_n != null ? `, n ${preview.hold.n_agrees ? 'agrees' : 'differs'}` : ''}).
							</p>
						{/if}
						<p class="text-brand-muted">
							Nothing is written by this preview. A flagged replicate keeps its value on the row
							with the reason beside it; the resolution adds an audit annotation carrying the
							numbers before and after.
						</p>
					{/if}
				</div>
			{/if}

			{#if hold.status === 'remediated' && hold.resolution && resolutionIndexes(hold).length > 0}
				<div class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-1">
					<p>
						Replicates flagged: <span class="font-mono">{resolutionIndexes(hold).join(', ')}</span>
					</p>
					{#if hold.resolution.reason}
						<p class="text-brand-muted">Reason: {hold.resolution.reason}</p>
					{/if}
				</div>
			{/if}
			{/if}
		</div>
	{/snippet}

	{#snippet detailActions(hold, ctx)}
		{#if hold.status === 'pending' && hold.kind === 'brake_fired'}
			<ConfirmPopover
				message="Release the brake for {streamLabel(hold)}? Exactly one braked-scale reconciliation pass is admitted on the next sync cycle; a later reshape brakes afresh."
				confirmLabel="Release"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcknowledgeHold(hold, ctx, 'Brake released: the next pass may apply the reshape')}
			>
				<Button variant="primary" disabled={acknowledging}>{acknowledging ? 'Releasing…' : 'Release the brake'}</Button>
			</ConfirmPopover>
		{:else if hold.status === 'pending' && hold.kind === 'source_modified'}
			<ConfirmPopover
				message="Mark this reviewed? The correction has already applied; the curation on the affected reading stands as it is."
				confirmLabel="Acknowledge"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcknowledgeHold(hold, ctx, 'Reviewed')}
			>
				<Button variant="primary" disabled={acknowledging}>Acknowledge</Button>
			</ConfirmPopover>
		{:else if hold.status === 'pending' && hold.kind === 'curve_claim_stripped'}
			<ConfirmPopover
				message="Mark this reviewed? The readings stay served uncorrected. To apply the correction, re-home the curve or repoint the stream's instrument, then re-sync; the source re-asserts the claim every cycle."
				confirmLabel="Acknowledge"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcknowledgeHold(hold, ctx, 'Reviewed: values stay uncorrected until the instrument mismatch is fixed')}
			>
				<Button variant="primary" disabled={acknowledging}>Acknowledge</Button>
			</ConfirmPopover>
		{:else if hold.status === 'pending' && (hold.kind === 'missing_output' || hold.kind === 'stale_output')}
			{#if hold.site_id}
				<ConfirmPopover
					message="Recompute this visit? Every calculation whose inputs resolve there runs again and its outputs are rewritten; this finding closes if the run rewrites {hold.parameter_code ?? 'the output'}. Unchanged calculations are skipped."
					confirmLabel="Recompute"
					confirmVariant="primary"
					above
					onconfirm={() => handleRecomputeVisit(hold, ctx)}
				>
					<Button variant="primary" disabled={recomputing}>{recomputing ? 'Recomputing…' : 'Recompute the visit'}</Button>
				</ConfirmPopover>
			{/if}
			{#if hold.site_name}
				<Button
					variant="secondary"
					onclick={() => { window.location.href = `${base}/sites/${encodeURIComponent(hold.site_name ?? '')}?tab=visits`; }}
				>Open the visit</Button>
			{/if}
			<ConfirmPopover
				message="Mark this finding reviewed? The stored values stay as they are; recomputing the visit resolves it properly."
				confirmLabel="Acknowledge"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcknowledgeHold(hold, ctx, 'Finding acknowledged')}
			>
				<Button disabled={acknowledging}>Acknowledge finding</Button>
			</ConfirmPopover>
		{:else if hold.status === 'pending' && needsDeclaration(hold)}
			{@const slot = undeclaredSlot(hold)}
			{@const others = (slot?.population_signature_holds ?? 1) - 1}
			{@const remaining = (slot?.open_holds ?? 1) - (slot?.population_signature_holds ?? 1)}
			<ConfirmPopover
				message="Declare the {estimatorLabel(declareChoice)} sd formula for {hold.site_name} / {hold.parameter_name}? This instant gets an audit annotation. Reversible with Reopen."
				confirmLabel="Declare for the parameter"
				confirmVariant="primary"
				above
				onconfirm={() => handleDeclare(hold, 'slot', ctx)}
			>
				{#snippet detail()}
					<CountList
						rows={[
							{ label: 'Samples recomputed', value: slot?.undeclared_samples ?? 0 },
							{ label: 'Holds resolved now', value: 1 },
							{ label: 'Holds closed on the next sync cycle', value: others },
							{ label: 'Holds remaining, other causes', value: remaining },
						]}
					/>
				{/snippet}
				<Button variant="primary" disabled={acknowledging}>
					{acknowledging ? 'Declaring…' : `Use ${declareChoice} sd for this parameter`}
				</Button>
			</ConfirmPopover>
			<ConfirmPopover
				message="Use the {estimatorLabel(declareChoice)} formula for this collection group only? {hold.site_name} / {hold.parameter_name} stays undeclared, so its other holds stay blocked. This instant keeps its own setting through later parameter-level changes, and is marked on the charts with an audit annotation. Reversible with Reopen."
				confirmLabel="Declare for this instant"
				confirmVariant="primary"
				above
				onconfirm={() => handleDeclare(hold, 'instant', ctx)}
			>
				<Button disabled={acknowledging}>…for this instant only</Button>
			</ConfirmPopover>
			{#if isFlaggable(hold)}
				<ConfirmPopover
					message="Flag the selected replicates for this instant? Their values stay on the rows with the reason; the mean and sd recompute from the rest and the instant gets an audit annotation carrying both numbers. Reopen restores the flags."
					confirmLabel="Flag"
					confirmVariant="primary"
					above
					onconfirm={() => handleFlag(hold, ctx)}
				>
					{#snippet detail()}
						<CountList
							rows={[
								{ label: 'Replicates flagged', value: [...selectedReplicates].sort((a, b) => a - b).join(', ') },
								{ label: 'Replicates remaining', value: hold.computed.n - selectedReplicates.size },
								...flagPreviewRows(),
							]}
						/>
					{/snippet}
					<Button
						disabled={acknowledging || selectedReplicates.size === 0 || selectedReplicates.size >= hold.computed.n}
						title={selectedReplicates.size >= hold.computed.n && hold.computed.n > 0 ? 'At least one replicate must remain unflagged' : undefined}
					>Flag selected replicates</Button>
				</ConfirmPopover>
			{/if}
		{:else if hold.status === 'pending'}
			<ConfirmPopover
				message="Mark every pending hold on {streamLabel(hold)} reviewed? No value changes: the statistics computed here stand for all of them, and each instant is marked on its parameter's charts with an audit annotation. Holds needing a standard-deviation formula for their parameter are not included."
				confirmLabel="Mark all reviewed"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcknowledgeStream(hold, ctx)}
			>
				<Button disabled={acknowledging}>Mark all pending reviewed for this stream</Button>
			</ConfirmPopover>
			{#if isFlaggable(hold)}
				<ConfirmPopover
					message="Flag the selected replicates for this instant? Their values stay on the rows with the reason; the mean and sd recompute from the rest and the instant gets an audit annotation carrying both numbers. Reopen restores the flags."
					confirmLabel="Flag"
					confirmVariant="primary"
					above
					onconfirm={() => handleFlag(hold, ctx)}
				>
					{#snippet detail()}
						<CountList
							rows={[
								{ label: 'Replicates flagged', value: [...selectedReplicates].sort((a, b) => a - b).join(', ') },
								{ label: 'Replicates remaining', value: hold.computed.n - selectedReplicates.size },
								...flagPreviewRows(),
							]}
						/>
					{/snippet}
					<Button
						disabled={acknowledging || selectedReplicates.size === 0 || selectedReplicates.size >= hold.computed.n}
						title={selectedReplicates.size >= hold.computed.n && hold.computed.n > 0 ? 'At least one replicate must remain unflagged' : undefined}
					>Flag selected replicates</Button>
				</ConfirmPopover>
			{/if}
			<ConfirmPopover
				message="Mark this hold reviewed? No stored value changes: the statistics computed here stand and the source's avg/sd stays recorded on this hold only. This instant is marked on its parameter's charts with an audit annotation naming both numbers. Reversible with Reopen."
				confirmLabel="Mark reviewed"
				confirmVariant="primary"
				above
				onconfirm={() => handleAccept(hold, ctx)}
			>
				<Button variant="primary" disabled={acknowledging}>{acknowledging ? 'Saving' : 'Mark reviewed'}</Button>
			</ConfirmPopover>
		{:else if hold.status === 'remediated'}
			<ConfirmPopover
				message="Return this hold to review? The audit annotation this decision added is removed."
				confirmLabel="Reopen"
				confirmVariant="primary"
				above
				onconfirm={() => handleReopen(hold, ctx)}
			>
				{#snippet detail()}
					<CountList rows={reopenRows(hold)} />
				{/snippet}
				<Button disabled={acknowledging}>Reopen</Button>
			</ConfirmPopover>
		{/if}
	{/snippet}
</EventPanel>
