<script lang="ts">
	// The site's status-event log: device status strings over a chosen window, offset-paged.
	import { GET } from '$api/client';
	import type { StatusEventsResponse } from '$lib/api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import PaginationControls from '$components/ui/PaginationControls.svelte';

	let {
		siteId,
		active,
		paramName,
	}: {
		siteId: string;
		/// Whether the tab is the one on screen: the log loads when it is, not before.
		active: boolean;
		paramName: (parameterId: string) => string;
	} = $props();

	const STATUS_PAGE_SIZE = 50;
	let statusEvents = $state<StatusEventsResponse['events']>([]);
	let statusTimeRange = $state<'24h' | '7d' | '30d'>('24h');
	let statusLoading = $state(false);
	let loadedSite = '';
	let statusOffset = $state(0);
	let statusTotal = $state(0);
	let statusLifetimeTotal = $state<number | null>(null);
	const statusPage = $derived(Math.floor(statusOffset / STATUS_PAGE_SIZE) + 1);
	const statusRangeStart = $derived(
		Date.now() - (statusTimeRange === '24h' ? 24 : statusTimeRange === '7d' ? 168 : 720) * 3600000,
	);

	// Loads once the tab is on screen, and again from the top when the page moves to another site.
	$effect(() => {
		if (!active || !siteId || siteId === loadedSite) return;
		loadedSite = siteId;
		statusOffset = 0;
		statusLifetimeTotal = null;
		void loadStatusEvents();
	});

	async function loadStatusEvents() {
		statusLoading = true;
		const hours = statusTimeRange === '24h' ? 24 : statusTimeRange === '7d' ? 168 : 720;
		const start = new Date(Date.now() - hours * 3600000).toISOString();
		try {
			const result = await GET<StatusEventsResponse>(
				`/api/sites/${siteId}/status_events`,
				{ start, limit: STATUS_PAGE_SIZE, offset: statusOffset, order: 'desc' }
			);
			statusEvents = result.events ?? [];
			statusTotal = result.total ?? 0;
			if (statusLifetimeTotal === null) {
				const all = await GET<StatusEventsResponse>(`/api/sites/${siteId}/status_events`, { limit: 1 });
				statusLifetimeTotal = all.total ?? 0;
			}
		} catch (e) {
			statusEvents = [];
			statusTotal = 0;
			toastStore.error(e instanceof Error ? `Failed to load status events: ${e.message}` : 'Failed to load status events');
		}
		finally { statusLoading = false; }
	}
</script>

	<div class="space-y-3">
		<div class="flex gap-1">
			{#each ['24h', '7d', '30d'] as range}
				<button
					onclick={() => { statusTimeRange = range as typeof statusTimeRange; statusOffset = 0; loadStatusEvents(); }}
					class="px-3 py-1 text-xs rounded-md cursor-pointer border-none {statusTimeRange === range ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{range}</button>
			{/each}
		</div>
		{#if statusLoading}
			<p class="text-sm text-brand-muted">Loading events…</p>
		{:else if statusEvents.length === 0}
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4 text-sm text-brand-muted space-y-1">
				<p class="font-medium text-brand-text">No status events since {formatDateTime(new Date(statusRangeStart))}.</p>
				<p>{statusLifetimeTotal ?? '…'} stored for this site in total.</p>
			</div>
		{:else}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Time</th>
						<th class="text-left px-4 py-2 font-semibold">Parameter</th>
						<th class="text-left px-4 py-2 font-semibold">Status</th>
					</tr></thead>
					<tbody>
						{#each statusEvents as evt}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2 text-xs">{formatDateTime(evt.time)}</td>
								<td class="px-4 py-2 text-xs">{paramName(evt.parameter_id)}</td>
								<td class="px-4 py-2"><span class="px-2 py-0.5 text-xs rounded-full bg-brand-bg text-brand-muted">{evt.value}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<PaginationControls
				total={statusTotal}
				page={statusPage}
				perPage={STATUS_PAGE_SIZE}
				onPageChange={(p) => { statusOffset = (p - 1) * STATUS_PAGE_SIZE; loadStatusEvents(); }}
			/>
		{/if}
	</div>
