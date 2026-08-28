<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { getActiveAlarms, acknowledgeAlarm, unacknowledgeAlarm, type ActiveAlarm } from '$api/service';
	import { formatRelativeTime } from '$lib/utils';
	import { eventBus, INGEST_COALESCE_MS } from '$lib/stores/events.svelte';
	import { alarmHref } from '$lib/alarms';

	const POLL_MS = 30_000;

	let alarms = $state<ActiveAlarm[]>([]);
	let open = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let ingestTimer: ReturnType<typeof setTimeout> | null = null;
	let unsub: (() => void) | null = null;

	function openPanel() {
		if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
		open = true;
	}

	function closePanel() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => { open = false; closeTimer = null; }, 200);
	}

	const unacknowledged = $derived(
		alarms.filter(a => !a.acknowledged).sort((a, b) => b.severity - a.severity),
	);
	const acknowledged = $derived(
		alarms.filter(a => a.acknowledged).sort((a, b) => b.severity - a.severity),
	);
	const badgeCount = $derived(unacknowledged.length);
	const maxSeverity = $derived(
		unacknowledged.reduce((max, a) => Math.max(max, a.severity), 0),
	);

	function severityDotClass(severity: number): string {
		if (severity >= 2) return 'bg-severity-alarm';
		if (severity === 1) return 'bg-severity-warning';
		return 'bg-brand-muted';
	}

	async function loadAlarms() {
		try {
			const result = await getActiveAlarms();
			alarms = result.alarms;
		} catch {
			/* ignore polling errors */
		}
	}

	let acking = $state<Set<string>>(new Set());

	async function ack(eventId: string, e: Event) {
		e.stopPropagation();
		e.preventDefault();
		acking = new Set(acking).add(eventId);
		try {
			await acknowledgeAlarm(eventId);
			await loadAlarms();
		} catch {
			/* ignore - the breach stays unacknowledged and can be retried */
		} finally {
			const next = new Set(acking);
			next.delete(eventId);
			acking = next;
		}
	}

	async function unack(eventId: string, e: Event) {
		e.stopPropagation();
		e.preventDefault();
		acking = new Set(acking).add(eventId);
		try {
			await unacknowledgeAlarm(eventId);
			await loadAlarms();
		} catch {
			/* ignore */
		} finally {
			const next = new Set(acking);
			next.delete(eventId);
			acking = next;
		}
	}

	function schedule() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = setTimeout(async () => {
			await loadAlarms();
			schedule();
		}, POLL_MS);
	}

	onMount(() => {
		loadAlarms().then(schedule);
		// Unfiltered by site, and this indicator sits in the shell on every page, so it sees the
		// whole cycle's events. Coalescing turns one alarm query per ingest into one per cycle;
		// the poll above stays the backstop, so nothing depends on this firing promptly.
		unsub = eventBus.subscribe('data_ingested', () => {
			if (ingestTimer) clearTimeout(ingestTimer);
			ingestTimer = setTimeout(() => {
				ingestTimer = null;
				loadAlarms();
			}, INGEST_COALESCE_MS);
		});
	});

	onDestroy(() => {
		if (pollTimer) clearTimeout(pollTimer);
		if (ingestTimer) clearTimeout(ingestTimer);
		if (closeTimer) clearTimeout(closeTimer);
		if (unsub) unsub();
	});
</script>

<div
	class="relative"
	role="group"
	onmouseenter={openPanel}
	onmouseleave={(e) => { if ((e as PointerEvent).pointerType !== 'touch') closePanel(); }}
>
	<button
		type="button"
		onclick={() => (open = !open)}
		class="relative p-1 text-white/80 hover:text-white bg-transparent border-none cursor-pointer flex items-center"
		title="Alarms"
		aria-label="Alarms"
	>
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</svg>
		{#if badgeCount > 0}
			<span
				class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full {maxSeverity >= 2 ? 'bg-severity-alarm text-white' : 'bg-severity-warning text-severity-warning-text'} text-[10px] font-semibold flex items-center justify-center"
			>{badgeCount}</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute right-0 top-full mt-1 w-80 bg-brand-surface text-brand-text rounded-md shadow-lg border border-brand-divider z-50 overflow-hidden"
		>
			<div class="flex items-center justify-between px-3 py-2 border-b border-brand-divider">
				<span class="text-sm font-semibold">Alarms</span>
				<a href="{base}/alarms" class="text-xs text-brand-primary no-underline hover:underline">View all</a>
			</div>
			{#snippet alarmRow(alarm: ActiveAlarm)}
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full shrink-0 {severityDotClass(alarm.severity)}"></span>
					<a
						href={alarmHref({ site_id: alarm.site_id, parameter_id: alarm.parameter_id, started_at: alarm.started_at ?? alarm.since })}
						class="text-sm font-medium text-brand-text no-underline hover:underline truncate"
					>{alarm.site_name}</a>
					<span class="ml-auto text-[10px] text-brand-muted whitespace-nowrap" title={alarm.started_at ? `Last reading: ${formatRelativeTime(alarm.since)}` : undefined}>{formatRelativeTime(alarm.started_at ?? alarm.since)}</span>
				</div>
				<div class="ml-4 flex items-center gap-2">
					<span class="text-xs text-brand-muted truncate">{alarm.parameter_name}: {alarm.current_value}</span>
					{#if alarm.acknowledged && alarm.event_id}
						<button
							type="button"
							onclick={(e) => unack(alarm.event_id!, e)}
							disabled={acking.has(alarm.event_id)}
							class="ml-auto text-[10px] text-brand-muted bg-transparent border border-brand-divider rounded px-1.5 py-0.5 cursor-pointer hover:bg-brand-bg disabled:opacity-50"
						>{acking.has(alarm.event_id) ? '…' : 'Unacknowledge'}</button>
					{:else if alarm.event_id}
						<button
							type="button"
							onclick={(e) => ack(alarm.event_id!, e)}
							disabled={acking.has(alarm.event_id)}
							class="ml-auto text-[10px] text-brand-primary bg-transparent border border-brand-divider rounded px-1.5 py-0.5 cursor-pointer hover:bg-brand-bg disabled:opacity-50"
						>{acking.has(alarm.event_id) ? '…' : 'Acknowledge'}</button>
					{/if}
				</div>
			{/snippet}

			<div class="max-h-80 overflow-y-auto">
				{#if alarms.length === 0}
					<p class="px-3 py-6 text-sm text-brand-muted text-center">No active alarms</p>
				{:else}
					{#each unacknowledged as alarm (alarm.site_id + ':' + alarm.parameter_id)}
						<div class="px-3 py-2 border-b border-brand-divider last:border-b-0">
							{@render alarmRow(alarm)}
						</div>
					{/each}
					{#if acknowledged.length > 0}
						<div class="px-3 py-1.5 text-xs font-semibold text-brand-muted bg-brand-bg">Acknowledged</div>
						{#each acknowledged as alarm (alarm.site_id + ':' + alarm.parameter_id)}
							<div class="px-3 py-2 border-b border-brand-divider last:border-b-0 opacity-60">
								{@render alarmRow(alarm)}
							</div>
						{/each}
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>
