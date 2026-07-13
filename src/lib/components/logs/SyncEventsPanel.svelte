<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { getList } from '$api/client';
	import type { SyncEvent, SyncService } from '$api/service';
	import { formatRelativeTime, formatDateTime, statusBadgeClass, formatDurationMs } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	const PER_PAGE = 100;

	let serviceMap = $state<Map<string, SyncService>>(new Map());
	let statusFilter = $state<'all' | 'running' | 'completed' | 'partial' | 'failed'>('all');

	async function fetchPage({ page, perPage }: { page: number; perPage: number }) {
		const filter: Record<string, unknown> = {};
		if (statusFilter !== 'all') filter.status = statusFilter;
		const result = await getList<SyncEvent>('/api/sync_events', {
			page,
			perPage,
			sort: ['started_at', 'DESC'],
			filter,
		});
		return { data: result.data, total: result.total };
	}

	function serviceName(serviceId: string): { label: string; href: string } {
		const svc = serviceMap.get(serviceId);
		return {
			label: svc?.instance_id ?? serviceId.slice(0, 8) + '…',
			href: `${base}/system`,
		};
	}

	onMount(async () => {
		try {
			const svcResult = await getList<SyncService>('/api/sync_services', { perPage: 50 });
			serviceMap = new Map(svcResult.data.map((s) => [s.id, s]));
		} catch { /* services lookup is best-effort */ }
	});
</script>

<EventPanel
	{fetchPage}
	perPage={PER_PAGE}
	colCount={7}
	emptyText="No sync events"
	pollWhile={(events) => events.some((e) => e.status === 'running')}
	detailTitle="Sync Event Detail"
	detailMaxWidth="md"
>
	{#snippet filterBar({ reload })}
		<div class="flex gap-1">
			{#each ['all', 'running', 'completed', 'partial', 'failed'] as s}
				<button
					onclick={() => { statusFilter = s as typeof statusFilter; reload(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {statusFilter === s ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{s}</button>
			{/each}
		</div>
		<Button onclick={reload}>Refresh</Button>
	{/snippet}

	{#snippet head()}
		<th class="text-left px-4 py-2 font-semibold">Service</th>
		<th class="text-left px-4 py-2 font-semibold">Type</th>
		<th class="text-left px-4 py-2 font-semibold">Status</th>
		<th class="text-right px-4 py-2 font-semibold">Readings</th>
		<th class="text-right px-4 py-2 font-semibold">Status Events</th>
		<th class="text-left px-4 py-2 font-semibold">Started</th>
		<th class="text-right px-4 py-2 font-semibold">Duration</th>
	{/snippet}

	{#snippet row(evt)}
		{@const svc = serviceName(evt.service_id)}
		<td class="px-4 py-2">
			<a href={svc.href} class="text-brand-primary no-underline hover:underline" onclick={(e) => e.stopPropagation()}>{svc.label}</a>
		</td>
		<td class="px-4 py-2 text-xs text-brand-muted">{evt.event_type}</td>
		<td class="px-4 py-2">
			<span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(evt.status)}">{evt.status}</span>
		</td>
		<td class="px-4 py-2 text-right font-mono text-xs">{evt.readings_synced}</td>
		<td class="px-4 py-2 text-right font-mono text-xs">{evt.status_events_synced}</td>
		<td class="px-4 py-2 text-xs text-brand-muted">{formatRelativeTime(evt.started_at)}</td>
		<td class="px-4 py-2 text-right font-mono text-xs text-brand-muted">{formatDurationMs(evt.duration_ms)}</td>
	{/snippet}

	{#snippet detail(evt)}
		{@const svc = serviceName(evt.service_id)}
		<div class="space-y-4 text-sm">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<span class="text-brand-muted text-xs">Service</span>
					<p><a href={svc.href} class="text-brand-primary no-underline hover:underline">{svc.label}</a></p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Type</span>
					<p>{evt.event_type}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Status</span>
					<p><span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(evt.status)}">{evt.status}</span></p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Duration</span>
					<p>{formatDurationMs(evt.duration_ms)}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Readings synced</span>
					<p class="font-mono">{evt.readings_synced}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Status events synced</span>
					<p class="font-mono">{evt.status_events_synced}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Started</span>
					<p>{formatDateTime(evt.started_at)}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Completed</span>
					<p>{evt.completed_at ? formatDateTime(evt.completed_at) : '—'}</p>
				</div>
			</div>

			{#if evt.errors?.length}
				<div>
					<span class="text-brand-muted text-xs block mb-1">Errors</span>
					<pre class="bg-severity-alarm-soft p-2 rounded text-xs whitespace-pre-wrap text-severity-alarm">{evt.errors.join('\n')}</pre>
				</div>
			{/if}
			{#if evt.log?.length}
				<div>
					<span class="text-brand-muted text-xs block mb-1">Log</span>
					<pre class="bg-brand-bg p-2 rounded text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">{evt.log.join('\n')}</pre>
				</div>
			{/if}
		</div>
	{/snippet}

	{#snippet detailActions(evt)}
		{@const svc = serviceName(evt.service_id)}
		<a href={svc.href} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm no-underline hover:opacity-90">View Service</a>
	{/snippet}
</EventPanel>
