<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Sensor, type ReprocessingJob, type JobLogLine } from '$api/crud';
	import { getJobLogs, rerunJob, isRerunnable } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime, triggerLabel, statusBadgeClass } from '$lib/utils';
	import Dialog from '$components/ui/Dialog.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import Button from '$components/ui/Button.svelte';

	const PER_PAGE = 100;
	const CATEGORIES = ['all', 'operator', 'metadata', 'maintenance'] as const;

	let jobs = $state<ReprocessingJob[]>([]);
	let sensorMap = $state<Map<string, string>>(new Map());
	let derivedMap = $state<Map<string, string>>(new Map());
	let loading = $state(true);
	let total = $state(0);
	let currentPage = $state(1);
	let statusFilter = $state<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');
	let categoryFilter = $state<(typeof CATEGORIES)[number]>('all');
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	let selectedJob = $state<ReprocessingJob | null>(null);
	let detailOpen = $state(false);
	let logs = $state<JobLogLine[]>([]);
	let logsLoading = $state(false);

	async function load() {
		loading = true;
		try {
			const filter: Record<string, unknown> = {};
			if (statusFilter !== 'all') filter.status = statusFilter;
			if (categoryFilter !== 'all') filter.category = categoryFilter;
			const result = await api.reprocessingJobs.list({
				page: currentPage,
				perPage: PER_PAGE,
				sort: ['created_at', 'DESC'],
				filter,
			});
			jobs = result.data;
			total = result.total;
		} finally {
			loading = false;
		}
	}

	async function openDetail(job: ReprocessingJob) {
		selectedJob = job;
		detailOpen = true;
		logs = [];
		logsLoading = true;
		try {
			logs = await getJobLogs(job.id);
		} catch {
			logs = [];
		} finally {
			logsLoading = false;
		}
	}

	const LEVEL_CLASS: Record<string, string> = {
		info: 'text-brand-muted',
		warn: 'text-severity-warning-text',
		error: 'text-severity-alarm',
	};

	let rerunning = $state(false);
	async function handleRerun() {
		if (!selectedJob) return;
		rerunning = true;
		try {
			await rerunJob(selectedJob.id);
			toastStore.success('Job rerun started');
			detailOpen = false;
			await load();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to rerun job');
		} finally {
			rerunning = false;
		}
	}

	onMount(async () => {
		const [sensors, derived] = await Promise.all([
			api.sensors.list({ perPage: 500 }),
			api.derivedParameters.list({ perPage: 500 }),
		]);
		sensorMap = new Map(sensors.data.map((s: Sensor) => [s.id, s.name ?? s.serial_number ?? s.id]));
		derivedMap = new Map(derived.data.map((d) => [d.id, d.name || d.code]));
		await load();
		pollTimer = setInterval(() => {
			if (jobs.some((j) => j.status === 'pending' || j.status === 'running')) {
				load();
			}
		}, 5000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});

	function jobTarget(job: ReprocessingJob): { label: string; href: string | null } {
		if (job.trigger_type === 'derived_recompute' && job.trigger_id) {
			return { label: derivedMap.get(job.trigger_id) ?? job.trigger_id, href: `${base}/derived/${job.trigger_id}` };
		}
		if (job.sensor_id) {
			return { label: sensorMap.get(job.sensor_id) ?? job.sensor_id, href: `${base}/sensors/${job.sensor_id}` };
		}
		return { label: 'None', href: null };
	}

	function progressPercent(job: ReprocessingJob): number | null {
		// A finished job is 100% even if it never reported a total (e.g. single-statement jobs).
		if (job.status === 'completed') return 100;
		if (job.total && job.total > 0 && job.progress != null) {
			return Math.min(100, Math.round((job.progress / job.total) * 100));
		}
		return null;
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-2 flex-wrap">
		<div class="flex gap-1">
			{#each ['all', 'pending', 'running', 'completed', 'failed'] as s}
				<button
					onclick={() => { statusFilter = s as typeof statusFilter; currentPage = 1; load(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {statusFilter === s ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{s}</button>
			{/each}
		</div>
		<div class="flex gap-1">
			{#each CATEGORIES as c}
				<button
					onclick={() => { categoryFilter = c; currentPage = 1; load(); }}
					class="px-3 py-1 text-xs rounded-md cursor-pointer border-none capitalize {categoryFilter === c ? 'bg-brand-accent text-white' : 'bg-brand-bg text-brand-muted'}"
				>{c}</button>
			{/each}
		</div>
		<Button onclick={load}>Refresh</Button>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Target</th>
					<th class="text-left px-4 py-2 font-semibold">Trigger</th>
					<th class="text-left px-4 py-2 font-semibold">Status</th>
					<th class="text-left px-4 py-2 font-semibold">Progress</th>
					<th class="text-right px-4 py-2 font-semibold">Readings</th>
					<th class="text-left px-4 py-2 font-semibold">Created</th>
					<th class="text-left px-4 py-2 font-semibold">Completed</th>
					<th class="text-left px-4 py-2 font-semibold">Error</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="8" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if jobs.length === 0}
					<tr><td colspan="8" class="px-4 py-8 text-center text-brand-muted">No jobs</td></tr>
				{:else}
					{#each jobs as job}
						{@const target = jobTarget(job)}
						{@const pct = progressPercent(job)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer" onclick={() => openDetail(job)}>
							<td class="px-4 py-2">
								{#if target.href}
									<a href={target.href} class="text-brand-primary no-underline hover:underline" onclick={(e) => e.stopPropagation()}>{target.label}</a>
								{:else}
									{target.label}
								{/if}
							</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{triggerLabel(job.trigger_type)}</td>
							<td class="px-4 py-2">
								<span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(job.status)}">{job.status}</span>
							</td>
							<td class="px-4 py-2 text-xs">
								{#if pct != null}
									<div class="flex items-center gap-2">
										<div class="w-16 h-1.5 bg-brand-bg rounded overflow-hidden">
											<div class="h-full bg-brand-primary" style:width="{pct}%"></div>
										</div>
										<span class="text-brand-muted font-mono text-[10px] whitespace-nowrap">{job.progress}/{job.total}</span>
									</div>
								{:else}
									<span class="text-brand-muted">—</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-right font-mono text-xs">{job.readings_updated ?? '—'}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{formatRelativeTime(job.created_at)}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{job.completed_at ? formatDateTime(job.completed_at) : '—'}</td>
							<td class="px-4 py-2 text-xs text-severity-alarm truncate max-w-xs" title={job.error_message ?? ''}>{job.error_message ?? ''}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls
		{total}
		page={currentPage}
		perPage={PER_PAGE}
		onPageChange={(p) => { currentPage = p; load(); }}
	/>
</div>

<Dialog bind:open={detailOpen} title="Job Detail" maxWidth="sm">
	{#snippet children()}
		{#if selectedJob}
			{@const target = jobTarget(selectedJob)}
			{@const pct = progressPercent(selectedJob)}
			<div class="space-y-4 text-sm">
				<div class="flex items-center gap-2">
					{#if target.href}
						<a href={target.href} class="text-brand-primary font-semibold no-underline hover:underline">{target.label}</a>
					{:else}
						<span class="font-semibold">{target.label}</span>
					{/if}
					<span class="text-brand-muted">·</span>
					<span class="text-brand-muted">{triggerLabel(selectedJob.trigger_type)}</span>
					<span class="px-2 py-0.5 text-[10px] rounded-full bg-brand-bg text-brand-muted capitalize">{selectedJob.category}</span>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<span class="text-brand-muted text-xs">Status</span>
						<p><span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(selectedJob.status)}">{selectedJob.status}</span></p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Progress</span>
						{#if pct != null}
							<div class="flex items-center gap-2 mt-1">
								<div class="w-20 h-1.5 bg-brand-bg rounded overflow-hidden">
									<div class="h-full bg-brand-primary" style:width="{pct}%"></div>
								</div>
								<span class="text-brand-muted font-mono text-xs">{selectedJob.progress}/{selectedJob.total}</span>
							</div>
						{:else}
							<p class="text-brand-muted">—</p>
						{/if}
					</div>
					<div>
						<span class="text-brand-muted text-xs">Readings updated</span>
						<p class="font-mono">{selectedJob.readings_updated ?? '—'}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Retry count</span>
						<p class="font-mono">{selectedJob.retry_count}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Created</span>
						<p>{formatDateTime(selectedJob.created_at)}</p>
					</div>
					<div>
						<span class="text-brand-muted text-xs">Completed</span>
						<p>{selectedJob.completed_at ? formatDateTime(selectedJob.completed_at) : '—'}</p>
					</div>
				</div>

				{#if selectedJob.error_message}
					<div>
						<span class="text-brand-muted text-xs block mb-1">Error</span>
						<pre class="bg-severity-alarm-soft p-2 rounded text-xs whitespace-pre-wrap text-severity-alarm">{selectedJob.error_message}</pre>
					</div>
				{/if}

				{#if selectedJob.detail && Object.keys(selectedJob.detail).length > 0}
					<div>
						<span class="text-brand-muted text-xs block mb-1">Provenance</span>
						<pre class="bg-brand-bg p-2 rounded text-xs whitespace-pre-wrap font-mono text-brand-text">{JSON.stringify(selectedJob.detail, null, 2)}</pre>
					</div>
				{/if}

				<div>
					<span class="text-brand-muted text-xs block mb-1">Timeline</span>
					{#if logsLoading}
						<p class="text-brand-muted text-xs">Loading…</p>
					{:else if logs.length === 0}
						<p class="text-brand-muted text-xs">No timeline entries.</p>
					{:else}
						<div class="bg-brand-bg rounded p-2 max-h-60 overflow-y-auto space-y-1 font-mono text-[11px]">
							{#each logs as line}
								<div class="flex gap-2">
									<span class="text-brand-muted whitespace-nowrap">{formatDateTime(line.ts)}</span>
									<span class="uppercase {LEVEL_CLASS[line.level] ?? 'text-brand-muted'}">{line.level}</span>
									<span class="{LEVEL_CLASS[line.level] ?? 'text-brand-text'}">{line.message}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if selectedJob}
			{@const target = jobTarget(selectedJob)}
			{#if isRerunnable(selectedJob.trigger_type)}
				<Button variant="primary" disabled={rerunning} onclick={handleRerun}>
					{rerunning ? 'Rerunning…' : 'Rerun'}
				</Button>
			{/if}
			{#if target.href}
				<a href={target.href} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm no-underline hover:opacity-90">View Target</a>
			{/if}
		{/if}
		<Button onclick={() => detailOpen = false}>Close</Button>
	{/snippet}
</Dialog>
