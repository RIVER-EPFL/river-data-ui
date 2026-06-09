<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { getList } from '$api/client';
	import type { SyncEvent, SyncService } from '$api/service';
	import { formatRelativeTime, formatDateTime, statusBadgeClass, formatDurationMs } from '$lib/utils';
	import Dialog from '$components/ui/Dialog.svelte';

	let events = $state<SyncEvent[]>([]);
	let serviceMap = $state<Map<string, SyncService>>(new Map());
	let loading = $state(true);
	let error = $state('');
	let statusFilter = $state<'all' | 'running' | 'completed' | 'partial' | 'failed'>('all');
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	let selectedEvent = $state<SyncEvent | null>(null);
	let detailOpen = $state(false);

	async function load() {
		loading = true;
		error = '';
		try {
			const filter: Record<string, unknown> = {};
			if (statusFilter !== 'all') filter.status = statusFilter;
			const result = await getList<SyncEvent>('/api/sync_events', {
				perPage: 100,
				sort: ['started_at', 'DESC'],
				filter,
			});
			events = result.data;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load sync events';
			events = [];
		} finally {
			loading = false;
		}
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
		await load();
		pollTimer = setInterval(() => {
			if (events.some((e) => e.status === 'running')) {
				load();
			}
		}, 5000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-2">
		<div class="flex gap-1">
			{#each ['all', 'running', 'completed', 'partial', 'failed'] as s}
				<button
					onclick={() => { statusFilter = s as typeof statusFilter; load(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {statusFilter === s ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{s}</button>
			{/each}
		</div>
		<button onclick={load} class="px-3 py-1.5 text-sm border border-brand-divider rounded-md bg-brand-surface cursor-pointer hover:bg-brand-bg">Refresh</button>
	</div>

	{#if error}
		<div class="rounded-md border border-severity-alarm-border bg-severity-alarm-soft p-3 text-sm text-severity-alarm">
			{error}
		</div>
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Service</th>
					<th class="text-left px-4 py-2 font-semibold">Type</th>
					<th class="text-left px-4 py-2 font-semibold">Status</th>
					<th class="text-right px-4 py-2 font-semibold">Readings</th>
					<th class="text-right px-4 py-2 font-semibold">Status Events</th>
					<th class="text-left px-4 py-2 font-semibold">Started</th>
					<th class="text-right px-4 py-2 font-semibold">Duration</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if events.length === 0}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">No sync events</td></tr>
				{:else}
					{#each events as evt}
						{@const svc = serviceName(evt.service_id)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer" onclick={() => { selectedEvent = evt; detailOpen = true; }}>
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
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>

<Dialog bind:open={detailOpen} title="Sync Event Detail" maxWidth="md">
	{#snippet children()}
		{#if selectedEvent}
			{@const svc = serviceName(selectedEvent.service_id)}
			<div class="space-y-4 text-sm">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<span class="text-brand-muted text-xs">Service</span>
						<p><a href={svc.href} class="text-brand-primary no-underline hover:underline">{svc.label}</a></p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Type</span>
						<p>{selectedEvent.event_type}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Status</span>
						<p><span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(selectedEvent.status)}">{selectedEvent.status}</span></p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Duration</span>
						<p>{formatDurationMs(selectedEvent.duration_ms)}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Readings synced</span>
						<p class="font-mono">{selectedEvent.readings_synced}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Status events synced</span>
						<p class="font-mono">{selectedEvent.status_events_synced}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Started</span>
						<p>{formatDateTime(selectedEvent.started_at)}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Completed</span>
						<p>{selectedEvent.completed_at ? formatDateTime(selectedEvent.completed_at) : '—'}</p>
					</div>
				</div>

				{#if selectedEvent.errors?.length}
					<div>
						<span class="text-brand-muted text-xs block mb-1">Errors</span>
						<pre class="bg-severity-alarm-soft p-2 rounded text-xs whitespace-pre-wrap text-severity-alarm">{selectedEvent.errors.join('\n')}</pre>
					</div>
				{/if}
				{#if selectedEvent.log?.length}
					<div>
						<span class="text-brand-muted text-xs block mb-1">Log</span>
						<pre class="bg-brand-bg p-2 rounded text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">{selectedEvent.log.join('\n')}</pre>
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if selectedEvent}
			{@const svc = serviceName(selectedEvent.service_id)}
			<a href={svc.href} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm no-underline hover:opacity-90">View Service</a>
		{/if}
		<button onclick={() => detailOpen = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Close</button>
	{/snippet}
</Dialog>
