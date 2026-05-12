<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { getActiveAlarms, type ActiveAlarm } from '$api/service';
	import { formatRelativeTime } from '$lib/utils';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let alarms = $state<ActiveAlarm[]>([]);
	let loading = $state(true);
	let filter = $state<'all' | 'warning' | 'alarm'>('all');
	let acked = $state<Set<string>>(new Set());
	let pollInterval: ReturnType<typeof setInterval>;

	const STORAGE_KEY = 'river-data-alarm-ack';

	function loadAcks() {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const entries: Array<{ key: string; until: number }> = JSON.parse(stored);
				acked = new Set(entries.filter((e) => e.until === 0 || e.until > Date.now()).map((e) => e.key));
			}
		} catch { /* ignore */ }
	}

	function saveAcks() {
		const entries = [...acked].map((key) => ({ key, until: 0 }));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	}

	async function loadAlarms() {
		try {
			const result = await getActiveAlarms();
			alarms = result.alarms;
		} catch { /* ignore polling errors */ }
		finally { loading = false; }
	}

	function alarmKey(a: ActiveAlarm): string {
		return `${a.site_id}:${a.parameter_id}`;
	}

	function acknowledge(a: ActiveAlarm) {
		acked.add(alarmKey(a));
		acked = new Set(acked);
		saveAcks();
	}

	function unacknowledge(a: ActiveAlarm) {
		acked.delete(alarmKey(a));
		acked = new Set(acked);
		saveAcks();
	}

	const filteredAlarms = $derived(() => {
		let filtered = alarms;
		if (filter === 'warning') filtered = filtered.filter((a) => a.severity === 1);
		if (filter === 'alarm') filtered = filtered.filter((a) => a.severity >= 2);
		return filtered;
	});

	const activeAlarms = $derived(filteredAlarms().filter((a) => !acked.has(alarmKey(a))));
	const ackedAlarms = $derived(filteredAlarms().filter((a) => acked.has(alarmKey(a))));

	export function badgeCount(): number {
		return alarms.filter((a) => !acked.has(alarmKey(a))).length;
	}

	onMount(() => { loadAcks(); loadAlarms(); pollInterval = setInterval(loadAlarms, 60_000); });
	onDestroy(() => clearInterval(pollInterval));
</script>

{#if open}
	<!-- Backdrop -->
	<div class="fixed inset-0 bg-black/20 z-40" onclick={() => open = false} role="presentation"></div>

	<!-- Drawer -->
	<div class="fixed right-0 top-0 h-full w-[420px] bg-brand-surface shadow-lg z-50 flex flex-col">
		<div class="flex items-center justify-between px-4 py-3 border-b border-brand-divider">
			<h3 class="text-base font-semibold">Alarm Notifications</h3>
			<button onclick={() => open = false} class="text-brand-muted hover:text-brand-text bg-transparent border-none cursor-pointer text-lg">&times;</button>
		</div>

		<!-- Filter -->
		<div class="flex gap-1 px-4 py-2">
			{#each [['all', 'All'], ['warning', 'Warning'], ['alarm', 'Alarm']] as [key, label]}
				<button
					onclick={() => filter = key as typeof filter}
					class="px-3 py-1 text-xs rounded-md cursor-pointer border-none {filter === key ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{label}</button>
			{/each}
		</div>

		<!-- Active alarms -->
		<div class="flex-1 overflow-y-auto">
			{#if loading}
				<p class="px-4 py-6 text-sm text-brand-muted">Loading...</p>
			{:else if activeAlarms.length === 0 && ackedAlarms.length === 0}
				<p class="px-4 py-6 text-sm text-brand-muted text-center">No active alarms</p>
			{:else}
				{#if activeAlarms.length > 0}
					<div class="px-4 py-2 text-xs font-semibold text-brand-muted">Active ({activeAlarms.length})</div>
					{#each activeAlarms as alarm}
						<div class="px-4 py-2 border-b border-brand-divider hover:bg-brand-bg/50">
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full {alarm.severity >= 2 ? 'bg-severity-alarm' : 'bg-severity-warning'}"></span>
								<a href="{base}/sites/{alarm.site_id}" class="text-sm font-semibold text-brand-text no-underline hover:underline" onclick={() => open = false}>{alarm.site_name}</a>
							</div>
							<div class="text-xs text-brand-muted ml-4 mt-0.5">{alarm.parameter_name}: {alarm.current_value}</div>
							<div class="text-xs text-brand-muted ml-4">Since {formatRelativeTime(alarm.since)}</div>
							<button onclick={() => acknowledge(alarm)} class="ml-4 mt-1 text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Acknowledge</button>
						</div>
					{/each}
				{/if}

				{#if ackedAlarms.length > 0}
					<div class="px-4 py-2 text-xs font-semibold text-brand-muted">Acknowledged ({ackedAlarms.length})</div>
					{#each ackedAlarms as alarm}
						<div class="px-4 py-2 border-b border-brand-divider opacity-60">
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full bg-brand-muted"></span>
								<span class="text-sm">{alarm.site_name} — {alarm.parameter_name}</span>
							</div>
							<button onclick={() => unacknowledge(alarm)} class="ml-4 mt-1 text-xs text-brand-muted bg-transparent border-none cursor-pointer hover:underline">Unacknowledge</button>
						</div>
					{/each}
				{/if}
			{/if}
		</div>
	</div>
{/if}
