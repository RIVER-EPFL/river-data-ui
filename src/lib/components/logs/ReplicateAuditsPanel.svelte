<script lang="ts">
	import { listReplicateAudits, acceptSourceCorrection, type ReplicateAuditHold } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import { AUDIT_QUEUE_KINDS, KIND_LABEL, KIND_STYLE, KIND_TIP } from '$lib/holds';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	const PER_PAGE = 100;

	type View = 'review' | 'resolved';

	let {
		onPendingChange,
		initialView = 'review',
		initialHoldId,
	}: {
		onPendingChange?: (pending: number) => void;
		initialView?: View;
		// One hold a point record linked to; the queue opens on it alone.
		initialHoldId?: string;
	} = $props();

	// Deliberate initial-value capture: the view is user-navigable after mount.
	// svelte-ignore state_referenced_locally
	let view = $state<View>(initialView);
	// svelte-ignore state_referenced_locally
	let focusHoldId = $state<string | null>(initialHoldId ?? null);
	let acknowledging = $state(false);

	const VIEW_STATUS: Record<View, string> = { review: 'pending', resolved: 'resolved' };

	async function loadPage({ page, perPage }: { page: number; perPage: number }) {
		const result = await listReplicateAudits({
			page,
			page_size: perPage,
			status: VIEW_STATUS[view],
			kind: AUDIT_QUEUE_KINDS.join(','),
			...(focusHoldId ? { id: focusHoldId } : {}),
		});
		onPendingChange?.(result.pending);
		return { data: result.holds, total: result.total };
	}

	function streamLabel(hold: ReplicateAuditHold): string {
		if (hold.site_name && hold.parameter_name) return `${hold.site_name} · ${hold.parameter_name}`;
		return hold.source_name ?? hold.source_key ?? 'unknown source';
	}

	const STATUS_LABEL: Record<ReplicateAuditHold['status'], string> = {
		pending: 'Needs review',
		deferred: 'Awaiting pairing',
		acknowledged: 'Reviewed',
		remediated: 'Resolved',
		use_portal: 'Legacy: source value applied',
		use_manual: 'Legacy: source value applied',
		consumed: 'Legacy: source value applied',
		superseded: 'Cleared at source',
	};

	function statusVariant(status: ReplicateAuditHold['status']): 'warning' | 'ok' | 'muted' | 'default' {
		switch (status) {
			case 'pending': return 'warning';
			case 'deferred': return 'muted';
			case 'superseded': return 'default';
			default: return 'ok';
		}
	}

	// The panel's own action is the source correction; every other kind is acted on from the
	// screen that raised it, through that screen's route.
	async function handleAcceptCorrection(
		hold: ReplicateAuditHold,
		ctx: { close: () => void; reload: () => Promise<void> },
		successMessage: string,
	) {
		acknowledging = true;
		try {
			await acceptSourceCorrection(hold.id);
			toastStore.success(successMessage);
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to acknowledge');
		} finally {
			acknowledging = false;
		}
	}
</script>

<EventPanel
	load={loadPage}
	perPage={PER_PAGE}
	colCount={5}
	emptyText={view === 'review' ? 'Nothing needs review' : 'No resolved holds'}
	detailTitle="Audit hold"
	detailMaxWidth="md"
>
	{#snippet filterBar({ reload })}
		<div class="flex gap-1 flex-wrap">
			{#each [
				{ key: 'review' as View, label: 'Needs review' },
				{ key: 'resolved' as View, label: 'Resolved' },
			] as v}
				<button
					onclick={() => { view = v.key; reload(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {view === v.key ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{v.label}</button>
			{/each}
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
	{/snippet}

	{#snippet head()}
		<th class="text-left px-4 py-2 font-semibold">Stream</th>
		<th class="text-left px-4 py-2 font-semibold">Instant</th>
		<th class="text-left px-3 py-2 font-semibold">Kind</th>
		<th class="text-left px-4 py-2 font-semibold">Status</th>
		<th class="text-left px-4 py-2 font-semibold">Age</th>
	{/snippet}

	{#snippet row(hold)}
		<td class="px-4 py-2 text-xs" title={hold.source_key ?? undefined}>
			<div class="flex items-center gap-1.5">
				<span class="px-1.5 py-0.5 rounded bg-brand-bg font-mono text-[10px] text-brand-muted shrink-0">{hold.source_system ?? 'audit'}</span>
				<span class="truncate max-w-56">{streamLabel(hold)}</span>
			</div>
		</td>
		<td class="px-4 py-2 text-xs">{formatDateTime(hold.group_time)}</td>
		<td class="px-3 py-2">
			<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {KIND_STYLE[hold.kind]}" title={KIND_TIP[hold.kind]}>
				{KIND_LABEL[hold.kind]}
			</span>
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
				<div>
					<span class="text-brand-muted text-xs">Instant</span>
					<p>{formatDateTime(hold.group_time)}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Status</span>
					<p><Badge variant={statusVariant(hold.status)}>{STATUS_LABEL[hold.status]}</Badge></p>
				</div>
				<div class="col-span-2">
					<span class="text-brand-muted text-xs">What happened</span>
					<p class="text-xs">{KIND_TIP[hold.kind]}</p>
				</div>
				{#if hold.acknowledged_at}
					<div>
						<span class="text-brand-muted text-xs">Resolved</span>
						<p>{formatDateTime(hold.acknowledged_at)}{hold.acknowledged_by ? ` by ${hold.acknowledged_by}` : ''}</p>
					</div>
				{/if}
			</div>

			<div class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-2">
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
			</div>
		</div>
	{/snippet}

	{#snippet detailActions(hold, ctx)}
		{#if hold.status === 'pending' && hold.kind === 'source_modified'}
			<ConfirmPopover
				message="Mark this reviewed? The correction has already applied; the curation on the affected reading stands as it is."
				confirmLabel="Acknowledge"
				confirmVariant="primary"
				above
				onconfirm={() => handleAcceptCorrection(hold, ctx, 'Reviewed')}
			>
				<Button variant="primary" disabled={acknowledging}>Acknowledge</Button>
			</ConfirmPopover>
		{/if}
	{/snippet}
</EventPanel>
