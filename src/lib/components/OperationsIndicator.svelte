<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { api, type ReprocessingJob } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime } from '$lib/utils';

	const ACTIVE_POLL_MS = 6000;
	const IDLE_POLL_MS = 30000;
	const RECENT_LINGER_MS = 8000;

	let jobs = $state<ReprocessingJob[]>([]);
	let open = $state(false);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let recentlyFinished = $state<Map<string, number>>(new Map());
	let seenTerminal = new Set<string>();

	const activeJobs = $derived(jobs.filter((j) => j.status === 'pending' || j.status === 'running'));
	const recentJobs = $derived(
		jobs.filter((j) => recentlyFinished.has(j.id) && j.status !== 'pending' && j.status !== 'running'),
	);
	const visibleJobs = $derived([...activeJobs, ...recentJobs]);
	const badgeCount = $derived(activeJobs.length);

	function triggerLabel(triggerType: string): string {
		switch (triggerType) {
			case 'janitor_run': return 'Janitor sweep';
			case 'derived_recompute': return 'Derived recompute';
			case 'calibration_update': return 'Calibration update';
			case 'deployment_update': return 'Deployment update';
			default: return triggerType;
		}
	}

	function progressPercent(job: ReprocessingJob): number | null {
		if (job.total && job.total > 0 && job.progress != null) {
			return Math.min(100, Math.round((job.progress / job.total) * 100));
		}
		return null;
	}

	function statusDotClass(status: string): string {
		switch (status) {
			case 'completed': return 'bg-severity-ok';
			case 'failed': return 'bg-severity-alarm';
			case 'running': return 'bg-severity-warning';
			default: return 'bg-brand-muted';
		}
	}

	async function load() {
		try {
			const result = await api.reprocessingJobs.list({
				perPage: 50,
				sort: ['created_at', 'DESC'],
			});
			const fetched = result.data;

			const now = Date.now();
			const linger = new Map(recentlyFinished);
			for (const job of fetched) {
				const terminal = job.status === 'completed' || job.status === 'failed';
				if (terminal && !seenTerminal.has(job.id)) {
					seenTerminal.add(job.id);
					linger.set(job.id, now + RECENT_LINGER_MS);
					if (job.status === 'failed') {
						toastStore.error(`Reprocessing failed: ${job.error_message ?? triggerLabel(job.trigger_type)}`);
					}
				}
			}
			for (const [id, until] of linger) {
				if (until <= now) linger.delete(id);
			}
			recentlyFinished = linger;
			jobs = fetched;
		} catch {
			/* ignore polling errors */
		}
	}

	function schedule() {
		if (pollTimer) clearTimeout(pollTimer);
		const delay = activeJobs.length > 0 || recentJobs.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS;
		pollTimer = setTimeout(tick, delay);
	}

	async function tick() {
		await load();
		schedule();
	}

	onMount(() => {
		tick();
	});

	onDestroy(() => {
		if (pollTimer) clearTimeout(pollTimer);
	});
</script>

<div
	class="relative"
	role="group"
	onmouseenter={() => (open = true)}
	onmouseleave={() => (open = false)}
>
	<button
		type="button"
		onclick={() => (open = !open)}
		class="relative p-1 text-white/80 hover:text-white bg-transparent border-none cursor-pointer flex items-center"
		title="Background operations"
		aria-label="Background operations"
	>
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
		</svg>
		{#if badgeCount > 0}
			<span
				class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-severity-warning text-white text-[10px] font-semibold flex items-center justify-center"
			>{badgeCount}</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute right-0 top-full mt-1 w-80 bg-brand-surface text-brand-text rounded-md shadow-lg border border-brand-divider z-50 overflow-hidden"
		>
			<div class="flex items-center justify-between px-3 py-2 border-b border-brand-divider">
				<span class="text-sm font-semibold">Operations</span>
				<a href="{base}/jobs" class="text-xs text-brand-primary no-underline hover:underline">View all</a>
			</div>
			<div class="max-h-80 overflow-y-auto">
				{#if visibleJobs.length === 0}
					<p class="px-3 py-6 text-sm text-brand-muted text-center">No active operations</p>
				{:else}
					{#each visibleJobs as job (job.id)}
						{@const pct = progressPercent(job)}
						<div class="px-3 py-2 border-b border-brand-divider last:border-b-0">
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full shrink-0 {statusDotClass(job.status)}"></span>
								<span class="text-sm font-medium">{triggerLabel(job.trigger_type)}</span>
								<span class="ml-auto text-[10px] text-brand-muted">{formatRelativeTime(job.created_at)}</span>
							</div>
							<div class="mt-1 flex items-center gap-2">
								<div class="flex-1 h-1.5 bg-brand-bg rounded overflow-hidden">
									<div
										class="h-full bg-brand-primary transition-[width] duration-300"
										style:width="{pct ?? (job.status === 'completed' ? 100 : 0)}%"
									></div>
								</div>
								<span class="text-[10px] font-mono text-brand-muted whitespace-nowrap">
									{#if job.total != null && job.progress != null}{job.progress}/{job.total}{:else}{job.status}{/if}
								</span>
							</div>
							{#if job.status === 'failed' && job.error_message}
								<p class="mt-1 text-xs text-severity-alarm break-words">{job.error_message}</p>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
