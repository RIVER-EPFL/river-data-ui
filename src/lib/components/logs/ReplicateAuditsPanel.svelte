<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import {
		listReplicateAudits,
		acknowledgeReplicateAudit,
		acknowledgeReplicateAuditsBulk,
		resolveReplicateAudit,
		reopenReplicateAudit,
		issueSyncCommand,
		getSyncCommand,
		type ReplicateAuditHold,
		type HoldKind,
		type SyncCommand,
		type SyncService,
	} from '$api/service';
	import { getList } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	const PER_PAGE = 100;

	// Three views instead of raw DB statuses: what needs a decision, what has one, and what is
	// waiting on pairing. 'resolved' is a server-side meta-status covering every past-review state.
	type View = 'review' | 'resolved' | 'deferred';

	let {
		onPendingChange,
		initialView = 'review',
	}: { onPendingChange?: (pending: number) => void; initialView?: View } = $props();

	// Deliberate initial-value capture: the view is user-navigable after mount.
	// svelte-ignore state_referenced_locally
	let view = $state<View>(initialView);
	let deferredCount = $state(0);
	let acknowledging = $state(false);
	// Server-side, so largest-first triage works across the whole backlog, not one page.
	let sortByScale = $state<'relative_delta_desc' | 'relative_delta_asc' | null>(null);
	// '' = all sources; a specific value both filters the list and targets the resync button.
	let sourceFilter = $state('');

	// Threshold bulk accept: one ceiling per statistic (percent of the mean magnitude), combined
	// with AND, plus the live count of pending holds the pair would acknowledge. The sd ceiling is
	// looser by default because the systematic sd offsets (population-vs-sample, portal rounding)
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

	function serviceActive(svc: SyncService): boolean {
		if (!svc.last_heartbeat) return false;
		return Date.now() - new Date(svc.last_heartbeat).getTime() < 300_000;
	}

	const syncService = $derived(
		syncServices.find((s) => s.service_type === sourceFilter && serviceActive(s)) ?? null,
	);

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

	async function fetchPage({ page, perPage }: { page: number; perPage: number }) {
		const result = await listReplicateAudits({
			page,
			page_size: perPage,
			status: VIEW_STATUS[view],
			...(sourceFilter ? { source_system: sourceFilter } : {}),
			...(sortByScale ? { sort: sortByScale } : {}),
		});
		onPendingChange?.(result.pending);
		deferredCount = result.deferred;
		visibleSources = [
			...new Set(result.holds.map((h) => h.source_system).filter((s): s is string => s != null)),
		].sort();
		refreshThresholdCount();
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

	// The portals store aggregate cells to 2 decimals; values display at that precision (full
	// precision in the tooltip) and a delta at or below the storage quantum is not colourable.
	const PORTAL_QUANTUM = 0.005;

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
		mid: 'bg-severity-warning',
		high: 'bg-severity-alarm',
	};
	const DELTA_TEXT: Record<Band, string> = {
		low: 'text-brand-muted',
		mid: 'text-severity-warning-text',
		high: 'text-severity-alarm',
	};

	// A delta at or below the portal's storage quantum is display noise, never coloured.
	function deltaClass(delta: number | null | undefined, rel: number): string {
		if (delta == null || Math.abs(delta) <= PORTAL_QUANTUM) return 'text-brand-muted';
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
			'The portal row has more non-null replicate cells than were stored here; a replicate was lost between the portal and our ingest.',
		population_sd:
			"The portal's sd matches the population formula (divisor n); ours uses the sample formula (divisor n-1), matching the portals' current calcSd.",
		stale_subset:
			"The portal's stored avg/sd match a computation over a subset of the replicates; a replicate added later did not update the stored cells.",
		quantization: "The disagreement is at the scale of the portal's 2-decimal storage.",
		unexplained: 'The disagreement does not match a known signature.',
	};

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
		replicate_stats: 'statistics',
		source_modified: 'source modified',
		brake_fired: 'brake fired',
		missing_output: 'missing output',
		stale_output: 'stale output',
	};
	const KIND_STYLE: Record<HoldKind, string> = {
		replicate_stats: 'bg-brand-bg text-brand-text',
		source_modified: 'bg-severity-warning-soft text-severity-warning-text',
		brake_fired: 'bg-severity-alarm-soft text-severity-alarm',
		missing_output: 'bg-severity-warning-soft text-severity-warning-text',
		stale_output: 'bg-severity-warning-soft text-severity-warning-text',
	};
	const KIND_TIP: Record<HoldKind, string> = {
		replicate_stats:
			"The group's recomputed statistics disagree with the portal's stored avg/sd.",
		source_modified:
			'The source changed or withdrew a reading that carries curation (a flag, a hand-picked curve, or a labelled sample). The value change applied; the curation and servedness did not move without this review.',
		brake_fired:
			'A reconciliation pass wanted to change or withdraw more of this stream than the brake allows. Its new rows applied; the reshape did not. Acknowledging admits exactly one braked-scale pass on the next sync cycle.',
		missing_output:
			"The tool's declared inputs exist at this visit but its output was never saved.",
		stale_output:
			'The stored output disagrees with a recompute under the same pinned script version, typically after an upstream correction.',
	};

	function isStats(hold: ReplicateAuditHold): boolean {
		return !hold.kind || hold.kind === 'replicate_stats';
	}

	const STATUS_LABEL: Record<ReplicateAuditHold['status'], string> = {
		pending: 'Needs review',
		deferred: 'Awaiting pairing',
		acknowledged: 'Accepted',
		remediated: 'Replicates flagged',
		use_portal: 'Applied',
		use_manual: 'Applied',
		consumed: 'Applied',
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
			toastStore.success(
				`Accepted ${res.acknowledged} hold${res.acknowledged === 1 ? '' : 's'} under x̄ ≤ ${meanThresholdPct}% and s ≤ ${sdThresholdPct}%`,
			);
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to accept');
		} finally {
			acknowledging = false;
		}
	}

	// Per-open resolution state: which replicate indexes to flag, and why.
	let selectedReplicates = $state<Set<number>>(new Set());
	let flagReason = $state('');

	function toggleReplicate(idx: number) {
		const next = new Set(selectedReplicates);
		if (next.has(idx)) next.delete(idx);
		else next.add(idx);
		selectedReplicates = next;
	}

	async function handleAccept(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		acknowledging = true;
		try {
			await resolveReplicateAudit(hold.id, { mode: 'ours' });
			toastStore.success('Our statistics stand for this instant');
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to accept');
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
			toastStore.success(`Accepted ${res.acknowledged} hold${res.acknowledged === 1 ? '' : 's'} for ${streamLabel(hold)}`);
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to accept');
		} finally {
			acknowledging = false;
		}
	}

	function resolutionIndexes(hold: ReplicateAuditHold): number[] {
		return hold.resolution?.replicate_indexes ?? [];
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

{#snippet scaleBar(label: string, rel: number)}
	<div class="flex items-center gap-1.5">
		<span class="w-3 shrink-0 font-mono text-[10px] text-brand-muted">{label}</span>
		<div class="w-16 h-1 rounded-sm bg-brand-bg border border-brand-divider overflow-hidden shrink-0">
			<div
				class="h-full {BAR_FILL[band(rel)]}"
				style="width: {Math.min((rel * 100) / METER_CAP_PCT, 1) * 100}%"
			></div>
		</div>
		<span class="font-mono text-[10px] text-brand-muted">{fmtPct(rel)}</span>
	</div>
{/snippet}

<EventPanel
	{fetchPage}
	perPage={PER_PAGE}
	colCount={13}
	rowClass={(hold) => (underThreshold(hold) ? 'bg-severity-ok-soft' : '')}
	emptyText={view === 'review' ? 'Nothing needs review' : view === 'resolved' ? 'No resolved holds' : 'No holds awaiting pairing'}
	detailTitle="Replicate Audit Hold"
	detailMaxWidth="md"
	onOpenDetail={() => { selectedReplicates = new Set(); flagReason = ''; }}
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
				message="Accept {thresholdCount ?? '…'} pending hold{thresholdCount === 1 ? '' : 's'} whose mean disagreement is at or below {meanThresholdPct}% and sd disagreement at or below {sdThresholdPct}%? The recomputed statistics stand for all of them."
				confirmLabel="Accept {thresholdCount ?? ''}"
				confirmVariant="primary"
				onconfirm={() => handleBulkThreshold({ reload })}
			>
				<Button disabled={acknowledging || !thresholdCount}>
					Accept {thresholdCount ?? '…'} under threshold
				</Button>
			</ConfirmPopover>
		</div>
		<Button onclick={reload}>Refresh</Button>
		{#if view === 'deferred'}
			<p class="w-full text-xs text-brand-muted">
				These streams are not paired to a site yet. The discrepancies become reviewable when the
				stream is paired.
			</p>
		{/if}
	{/snippet}

	{#snippet head({ reload })}
		<th class="text-left px-4 py-2 font-semibold">Stream</th>
		<th class="text-left px-4 py-2 font-semibold">Instant</th>
		<th class="text-right px-4 py-2 font-semibold" title="Replicate count: portal (non-null cells) / ours (unflagged stored replicates)">n</th>
		<th class="text-right px-3 py-2 font-semibold">Mean portal</th>
		<th class="text-right px-3 py-2 font-semibold" title="AVG(COALESCE(calibrated_value, raw_value)) over the unflagged replicates">Mean ours</th>
		<th class="text-right px-3 py-2 font-semibold">Δ mean</th>
		<th class="text-right px-3 py-2 font-semibold">SD portal</th>
		<th class="text-right px-3 py-2 font-semibold" title="STDDEV_SAMP: sqrt(Σ(x - x̄)² / (n - 1)), matching the portals' sd()">SD ours</th>
		<th class="text-right px-3 py-2 font-semibold">Δ sd</th>
		<th class="text-left px-3 py-2 font-semibold">
			<button
				onclick={(e) => { e.stopPropagation(); sortByScale = sortByScale === 'relative_delta_desc' ? 'relative_delta_asc' : 'relative_delta_desc'; reload(); }}
				class="bg-transparent border-none cursor-pointer font-semibold text-inherit p-0"
				title="Sort by overall disagreement size (max of x̄ and s) across all pages"
			>Δ scale {sortByScale === 'relative_delta_desc' ? '▾' : sortByScale === 'relative_delta_asc' ? '▴' : '↕'}</button>
		</th>
		<th class="text-left px-3 py-2 font-semibold">Cause</th>
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
		<td class="px-4 py-2 text-right font-mono text-xs" title="Replicate count: portal / ours">
			{#if nMismatch(hold)}
				<span class="px-1 py-0.5 rounded bg-severity-alarm-soft text-severity-alarm" title={CLASS_TIP.n_mismatch}>{hold.expected.n} / {hold.computed.n}</span>
			{:else}
				{hold.expected.n ?? '–'} / {hold.computed.n}
			{/if}
		</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.expected.mean)}>{fmtStat(hold.expected.mean)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.computed.mean)}>{fmtStat(hold.computed.mean)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs {deltaClass(hold.delta.mean, hold.mean_relative_delta)}" title={fullValue(hold.delta.mean)}>{fmt(hold.delta.mean)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.expected.sd)}>{fmtStat(hold.expected.sd)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs" title={fullValue(hold.computed.sd)}>{fmtStat(hold.computed.sd)}</td>
		<td class="px-3 py-2 text-right font-mono text-xs {deltaClass(hold.delta.sd, hold.sd_relative_delta)}" title={fullValue(hold.delta.sd)}>{fmt(hold.delta.sd)}</td>
		<td class="px-3 py-2">
			<div class="space-y-0.5" title="Per-statistic disagreement relative to the mean magnitude (bars capped at {METER_CAP_PCT}%)">
				{@render scaleBar('x̄', hold.mean_relative_delta)}
				{@render scaleBar('s', hold.sd_relative_delta)}
			</div>
		</td>
		<td class="px-3 py-2">
			{#if isStats(hold)}
				<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {CLASS_STYLE[hold.classification]}" title={CLASS_TIP[hold.classification]}>
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
					<p>{hold.source_system ?? '—'}</p>
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
					<span class="text-brand-muted text-xs">Cause</span>
					<p class="text-xs">{isStats(hold) ? CLASS_TIP[hold.classification] : KIND_TIP[hold.kind]}</p>
				</div>
				{#if hold.acknowledged_at}
					<div>
						<span class="text-brand-muted text-xs">Resolved</span>
						<p>{formatDateTime(hold.acknowledged_at)}{hold.acknowledged_by ? ` by ${hold.acknowledged_by}` : ''}</p>
					</div>
				{/if}
			</div>

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
							<th class="text-right px-3 py-1.5 font-semibold">Portal (expected)</th>
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
							<td class="px-3 py-1.5 text-brand-muted" title="STDDEV_SAMP: sqrt(Σ(x - x̄)² / (n - 1)), matching the portals' sd()">SD</td>
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
								from here. Accepting our statistics is still available.
							</p>
						{/if}
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
		{:else if hold.status === 'pending' && (hold.kind === 'missing_output' || hold.kind === 'stale_output')}
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
		{:else if hold.status === 'pending'}
			<ConfirmPopover
				message="Accept every pending hold on {streamLabel(hold)}? The recomputed statistics stand for all of them."
				confirmLabel="Accept all"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcknowledgeStream(hold, ctx)}
			>
				<Button disabled={acknowledging}>Accept all pending for this stream</Button>
			</ConfirmPopover>
			{#if isFlaggable(hold)}
				<ConfirmPopover
					message="Flag replicate{selectedReplicates.size === 1 ? '' : 's'} {[...selectedReplicates].sort((a, b) => a - b).join(', ')} for this instant? Flagged replicates are excluded from the mean and sd, which recompute immediately from the remaining {hold.computed.n - selectedReplicates.size}."
					confirmLabel="Flag"
					confirmVariant="primary"
					above
					onconfirm={() => handleFlag(hold, ctx)}
				>
					<Button
						disabled={acknowledging || selectedReplicates.size === 0 || selectedReplicates.size >= hold.computed.n}
						title={selectedReplicates.size >= hold.computed.n && hold.computed.n > 0 ? 'At least one replicate must remain unflagged' : undefined}
					>Flag selected replicates</Button>
				</ConfirmPopover>
			{/if}
			<ConfirmPopover
				message="Accept our statistics for this instant? The portal's stored avg/sd for it stays recorded on this hold only."
				confirmLabel="Accept"
				confirmVariant="primary"
				above
				onconfirm={() => handleAccept(hold, ctx)}
			>
				<Button variant="primary" disabled={acknowledging}>{acknowledging ? 'Resolving…' : 'Accept our statistics'}</Button>
			</ConfirmPopover>
		{:else if hold.status === 'remediated'}
			<ConfirmPopover
				message="Unflag the replicates this resolution flagged and return the hold to review? The statistics recompute from all replicates again."
				confirmLabel="Reopen"
				confirmVariant="primary"
				above
				onconfirm={() => handleReopen(hold, ctx)}
			>
				<Button disabled={acknowledging}>Reopen</Button>
			</ConfirmPopover>
		{/if}
	{/snippet}
</EventPanel>
