<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { getActiveAlarms, type ActiveAlarm } from '$api/service';
	import { formatRelativeTime } from '$lib/utils';
	import { eventBus } from '$lib/stores/events.svelte';

	const POLL_MS = 30_000;

	let alarms = $state<ActiveAlarm[]>([]);
	let open = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let unsub: (() => void) | null = null;

	function openPanel() {
		if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
		open = true;
	}

	function closePanel() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => { open = false; closeTimer = null; }, 200);
	}

	const sortedAlarms = $derived(
		[...alarms].sort((a, b) => b.severity - a.severity),
	);
	const badgeCount = $derived(alarms.length);
	const maxSeverity = $derived(
		alarms.reduce((max, a) => Math.max(max, a.severity), 0),
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

	function schedule() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = setTimeout(async () => {
			await loadAlarms();
			schedule();
		}, POLL_MS);
	}

	onMount(() => {
		loadAlarms().then(schedule);
		unsub = eventBus.subscribe('data_ingested', () => {
			loadAlarms();
		});
	});

	onDestroy(() => {
		if (pollTimer) clearTimeout(pollTimer);
		if (closeTimer) clearTimeout(closeTimer);
		if (unsub) unsub();
	});
</script>

<div
	class="relative"
	role="group"
	onmouseenter={openPanel}
	onmouseleave={closePanel}
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
				class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full {maxSeverity >= 2 ? 'bg-severity-alarm' : 'bg-severity-warning'} text-white text-[10px] font-semibold flex items-center justify-center"
			>{badgeCount}</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute right-0 top-full mt-1 w-80 bg-brand-surface text-brand-text rounded-md shadow-lg border border-brand-divider z-50 overflow-hidden"
		>
			<div class="flex items-center justify-between px-3 py-2 border-b border-brand-divider">
				<span class="text-sm font-semibold">Alarms</span>
				<a href="{base}/alarm-thresholds" class="text-xs text-brand-primary no-underline hover:underline">View all</a>
			</div>
			<div class="max-h-80 overflow-y-auto">
				{#if sortedAlarms.length === 0}
					<p class="px-3 py-6 text-sm text-brand-muted text-center">No active alarms</p>
				{:else}
					{#each sortedAlarms as alarm (alarm.site_id + ':' + alarm.parameter_id)}
						<div class="px-3 py-2 border-b border-brand-divider last:border-b-0">
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full shrink-0 {severityDotClass(alarm.severity)}"></span>
								<a
									href="{base}/sites/{alarm.site_id}"
									class="text-sm font-medium text-brand-text no-underline hover:underline truncate"
								>{alarm.site_name}</a>
								<span class="ml-auto text-[10px] text-brand-muted whitespace-nowrap">{formatRelativeTime(alarm.since)}</span>
							</div>
							<div class="ml-4 text-xs text-brand-muted truncate">{alarm.parameter_name}: {alarm.current_value}</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
