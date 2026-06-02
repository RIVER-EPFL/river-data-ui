<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { api, type ReprocessingJob } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { eventBus } from '$lib/stores/events.svelte';
	import { formatRelativeTime, triggerLabel } from '$lib/utils';

	const POLL_MS = 10_000;
	const RECENT_LINGER_MS = 5000;

	let jobs = $state<ReprocessingJob[]>([]);
	let open = $state(false);
	let closeTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let recentlyFinished = $state<Map<string, number>>(new Map());
	let seenTerminal = new Set<string>();
	let consecutiveErrors = $state(0);
	let initialLoad = true;

	const activeJobs = $derived(jobs.filter((j) => j.status === 'pending' || j.status === 'running'));
	const recentJobs = $derived(
		jobs.filter((j) => recentlyFinished.has(j.id) && j.status !== 'pending' && j.status !== 'running'),
	);
	const recentJobIds = $derived(new Set(recentJobs.map((j) => j.id)));
	const completedJobs = $derived(
		jobs.filter((j) => (j.status === 'completed' || j.status === 'failed') && !recentJobIds.has(j.id)).slice(0, 3),
	);
	const badgeCount = $derived(activeJobs.length);

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
					if (!initialLoad) {
						linger.set(job.id, now + RECENT_LINGER_MS);
						if (job.status === 'failed') {
							toastStore.error(`Reprocessing failed: ${job.error_message ?? triggerLabel(job.trigger_type)}`);
						}
					}
				}
			}
			initialLoad = false;
			for (const [id, until] of linger) {
				if (until <= now) linger.delete(id);
			}
			recentlyFinished = linger;
			jobs = fetched;
			if (seenTerminal.size > 200) seenTerminal.clear();
			consecutiveErrors = 0;
		} catch {
			consecutiveErrors++;
		}
	}

	function schedule() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = setTimeout(tick, POLL_MS);
	}

	async function tick() {
		await load();
		schedule();
	}

	function openPanel() {
		if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
		open = true;
	}

	function closePanel() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => { open = false; closeTimer = null; }, 200);
	}

	let unsubCreated: (() => void) | null = null;
	let unsubCompleted: (() => void) | null = null;
	let unsubProgress: (() => void) | null = null;

	onMount(() => {
		tick();

		unsubCreated = eventBus.subscribe('job_created', () => { load(); });
		unsubCompleted = eventBus.subscribe('job_completed', () => { load(); });
		unsubProgress = eventBus.subscribe('job_progress', (event) => {
			const e = event as { job_id: string; status: string; progress: number | null; total: number | null };
			jobs = jobs.map(j => j.id === e.job_id ? { ...j, status: e.status, progress: e.progress, total: e.total } : j);
		});
	});

	onDestroy(() => {
		if (pollTimer) clearTimeout(pollTimer);
		if (closeTimer) clearTimeout(closeTimer);
		unsubCreated?.();
		unsubCompleted?.();
		unsubProgress?.();
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
			{#if consecutiveErrors > 5}
				<div class="px-3 py-1 text-xs text-severity-warning bg-severity-warning-soft">Connection issue — retrying</div>
			{/if}
			<div class="max-h-96 overflow-y-auto">
				{#if activeJobs.length === 0 && recentJobs.length === 0 && completedJobs.length === 0}
					<p class="px-3 py-6 text-sm text-brand-muted text-center">No active operations</p>
				{:else}
					{#each [...activeJobs, ...recentJobs] as job (job.id)}
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
					{#if completedJobs.length > 0}
						<div class="px-3 py-1.5 text-xs font-semibold text-brand-muted bg-brand-bg">Recent</div>
						{#each completedJobs as job (job.id)}
							<div class="px-3 py-2 border-b border-brand-divider last:border-b-0 opacity-60">
								<div class="flex items-center gap-2">
									<span class="w-2 h-2 rounded-full shrink-0 {statusDotClass(job.status)}"></span>
									<span class="text-sm">{triggerLabel(job.trigger_type)}</span>
									<span class="ml-auto text-[10px] text-brand-muted">{job.completed_at ? formatRelativeTime(job.completed_at) : formatRelativeTime(job.created_at)}</span>
								</div>
								{#if job.status === 'failed' && job.error_message}
									<p class="mt-1 text-xs text-severity-alarm break-words">{job.error_message}</p>
								{/if}
							</div>
						{/each}
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>
