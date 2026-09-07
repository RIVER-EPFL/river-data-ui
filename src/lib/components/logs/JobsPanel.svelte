<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Sensor, type ReprocessingJob, type JobLogLine } from '$api/crud';
	import { getJobLogs, rerunJob, cancelJob } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import {
		formatRelativeTime,
		formatDateTime,
		triggerLabel,
		statusBadgeClass,
		countLabel,
		headlineFor,
	} from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	const PER_PAGE = 100;
	const CATEGORIES = ['all', 'operator', 'metadata', 'maintenance'] as const;

	let sensorMap = $state<Map<string, string>>(new Map());
	let derivedMap = $state<Map<string, string>>(new Map());
	let statusFilter = $state<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');
	let categoryFilter = $state<(typeof CATEGORIES)[number]>('all');

	let logs = $state<JobLogLine[]>([]);
	let logsLoading = $state(false);

	async function loadPage({ page, perPage }: { page: number; perPage: number }) {
		const filter: Record<string, unknown> = {};
		if (statusFilter !== 'all') filter.status = statusFilter;
		if (categoryFilter !== 'all') filter.category = categoryFilter;
		const result = await api.reprocessingJobs.list({
			page,
			perPage,
			sort: ['created_at', 'DESC'],
			filter,
		});
		return { data: result.data, total: result.total };
	}

	async function loadLogs(job: ReprocessingJob) {
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
	async function handleRerun(job: ReprocessingJob, ctx: { close: () => void; reload: () => Promise<void> }) {
		rerunning = true;
		try {
			await rerunJob(job.id);
			toastStore.success(`Job rerun started${inputSummary(job)}`);
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to rerun job');
		} finally {
			rerunning = false;
		}
	}

	/// What the replay will run with, so the operator confirms a rerun against its inputs.
	function inputSummary(job: ReprocessingJob): string {
		const entries = Object.entries(job.params ?? {});
		if (entries.length === 0) return '';
		const named = entries
			.map(([key, value]) => `${countLabel(key)}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
			.join(', ');
		return ` (${named})`;
	}

	let cancelling = $state(false);
	function isRunning(job: ReprocessingJob): boolean {
		return job.status === 'pending' || job.status === 'running' || job.status === 'retrying';
	}
	async function handleCancel(job: ReprocessingJob, ctx: { close: () => void; reload: () => Promise<void> }) {
		cancelling = true;
		try {
			await cancelJob(job.id);
			toastStore.success('Cancellation requested');
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to cancel job');
		} finally {
			cancelling = false;
		}
	}

	onMount(async () => {
		const [sensors, derived] = await Promise.all([
			api.sensors.list({ perPage: 500 }),
			api.derivedParameters.list({ perPage: 500 }),
		]);
		sensorMap = new Map(sensors.data.map((s: Sensor) => [s.id, s.name ?? s.serial_number ?? s.id]));
		derivedMap = new Map(derived.data.map((d) => [d.id, d.name || d.code]));
	});

	function jobTarget(job: ReprocessingJob): { label: string; href: string | null } {
		if (job.trigger_type === 'derived_recompute' && job.trigger_id) {
			return { label: derivedMap.get(job.trigger_id) ?? job.trigger_id, href: `${base}/derived/${job.trigger_id}` };
		}
		if (job.trigger_type === 'replicate_reconciliation' || job.trigger_type === 'replicate_reconciliation_delete') {
			const scope = job.detail?.scope as Record<string, unknown> | undefined;
			const source = typeof scope?.source_system === 'string' ? scope.source_system : 'Streams';
			return { label: source, href: `${base}/streams/reconciliation?job=${job.id}` };
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

	function reportCounts(job: ReprocessingJob): Record<string, number> {
		const counts = (job.detail as { counts?: unknown } | null)?.counts;
		if (!counts || typeof counts !== 'object') return {};
		return Object.fromEntries(
			Object.entries(counts as Record<string, unknown>).filter(
				(entry): entry is [string, number] => typeof entry[1] === 'number',
			),
		);
	}

	function reportScope(job: ReprocessingJob): Record<string, unknown> {
		const scope = (job.detail as { scope?: unknown } | null)?.scope;
		if (!scope || typeof scope !== 'object') return {};
		return scope as Record<string, unknown>;
	}
</script>

<EventPanel
	load={loadPage}
	perPage={PER_PAGE}
	colCount={8}
	emptyText="No jobs"
	pollWhile={(jobs) => jobs.some((j) => j.status === 'pending' || j.status === 'running')}
	onOpenDetail={loadLogs}
	detailTitle="Job Detail"
	detailMaxWidth="sm"
>
	{#snippet filterBar({ reload })}
		<div class="flex gap-1">
			{#each ['all', 'pending', 'running', 'completed', 'failed'] as s}
				<button
					onclick={() => { statusFilter = s as typeof statusFilter; reload(); }}
					class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {statusFilter === s ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
				>{s}</button>
			{/each}
		</div>
		<div class="flex gap-1">
			{#each CATEGORIES as c}
				<button
					onclick={() => { categoryFilter = c; reload(); }}
					class="px-3 py-1 text-xs rounded-md cursor-pointer border-none capitalize {categoryFilter === c ? 'bg-brand-accent text-white' : 'bg-brand-bg text-brand-muted'}"
				>{c}</button>
			{/each}
		</div>
		<Button onclick={reload}>Refresh</Button>
	{/snippet}

	{#snippet head()}
		<th class="text-left px-4 py-2 font-semibold">Target</th>
		<th class="text-left px-4 py-2 font-semibold">Trigger</th>
		<th class="text-left px-4 py-2 font-semibold">Status</th>
		<th class="text-left px-4 py-2 font-semibold">Progress</th>
		<th class="text-right px-4 py-2 font-semibold">Reported</th>
		<th class="text-left px-4 py-2 font-semibold">Created</th>
		<th class="text-left px-4 py-2 font-semibold">Completed</th>
		<th class="text-left px-4 py-2 font-semibold">Error</th>
	{/snippet}

	{#snippet row(job)}
		{@const target = jobTarget(job)}
		{@const pct = progressPercent(job)}
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
				<span class="text-brand-muted">-</span>
			{/if}
		</td>
		<td class="px-4 py-2 text-right font-mono text-xs" title={headlineFor(job)?.label ?? ''}>{headlineFor(job)?.value ?? '-'}</td>
		<td class="px-4 py-2 text-xs text-brand-muted">{formatRelativeTime(job.created_at)}</td>
		<td class="px-4 py-2 text-xs text-brand-muted">{job.completed_at ? formatDateTime(job.completed_at) : '-'}</td>
		<td class="px-4 py-2 text-xs text-severity-alarm truncate max-w-xs" title={job.error_message ?? ''}>{job.error_message ?? ''}</td>
	{/snippet}

	{#snippet detail(job)}
		{@const target = jobTarget(job)}
		{@const pct = progressPercent(job)}
		<div class="space-y-4 text-sm">
			<div class="flex items-center gap-2">
				{#if target.href}
					<a href={target.href} class="text-brand-primary font-semibold no-underline hover:underline">{target.label}</a>
				{:else}
					<span class="font-semibold">{target.label}</span>
				{/if}
				<span class="text-brand-muted">·</span>
				<span class="text-brand-muted">{triggerLabel(job.trigger_type)}</span>
				<span class="px-2 py-0.5 text-[10px] rounded-full bg-brand-bg text-brand-muted capitalize">{job.category}</span>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<span class="text-brand-muted text-xs">Status</span>
					<p><span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(job.status)}">{job.status}</span></p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Progress</span>
					{#if pct != null}
						<div class="flex items-center gap-2 mt-1">
							<div class="w-20 h-1.5 bg-brand-bg rounded overflow-hidden">
								<div class="h-full bg-brand-primary" style:width="{pct}%"></div>
							</div>
							<span class="text-brand-muted font-mono text-xs">{job.progress}/{job.total}</span>
						</div>
					{:else}
						<p class="text-brand-muted">-</p>
					{/if}
				</div>
				<div>
					<span class="text-brand-muted text-xs">{headlineFor(job)?.label ?? 'Reported'}</span>
					<p class="font-mono">{headlineFor(job)?.value ?? '-'}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Retry count</span>
					<p class="font-mono">{job.retry_count}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Created</span>
					<p>{formatDateTime(job.created_at)}</p>
				</div>
				<div>
					<span class="text-brand-muted text-xs">Completed</span>
					<p>{job.completed_at ? formatDateTime(job.completed_at) : '-'}</p>
				</div>
			</div>

			{#if job.error_message}
				<div>
					<span class="text-brand-muted text-xs block mb-1">Error</span>
					<pre class="bg-severity-alarm-soft p-2 rounded text-xs whitespace-pre-wrap text-severity-alarm">{job.error_message}</pre>
				</div>
			{/if}

			{#if Object.keys(job.params ?? {}).length > 0}
				{@const inputs = Object.entries(job.params)}
				<div>
					<span class="text-brand-muted text-xs block mb-1">Inputs</span>
					<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
						{#each inputs as [key, value] (key)}
							<dt class="text-brand-muted">{countLabel(key)}</dt>
							<dd class="font-mono break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
						{/each}
					</dl>
				</div>
			{/if}

			{#if Object.keys(reportCounts(job)).length > 0}
				{@const counts = Object.entries(reportCounts(job))}
				<div>
					<span class="text-brand-muted text-xs block mb-1">Counts</span>
					<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
						{#each counts as [key, value] (key)}
							<dt class="text-brand-muted">{countLabel(key)}</dt>
							<dd class="font-mono text-right">{value}</dd>
						{/each}
					</dl>
				</div>
			{/if}

			{#if Object.keys(reportScope(job)).length > 0}
				{@const scope = Object.entries(reportScope(job))}
				<div>
					<span class="text-brand-muted text-xs block mb-1">Scope</span>
					<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
						{#each scope as [key, value] (key)}
							<dt class="text-brand-muted">{countLabel(key)}</dt>
							<dd class="font-mono break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
						{/each}
					</dl>
				</div>
			{/if}

			{#if job.detail && Object.keys(job.detail).length > 0}
				<details>
					<summary class="text-brand-muted text-xs cursor-pointer">Raw report</summary>
					<pre class="bg-brand-bg p-2 mt-1 rounded text-xs whitespace-pre-wrap font-mono text-brand-text">{JSON.stringify(job.detail, null, 2)}</pre>
				</details>
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
	{/snippet}

	{#snippet detailActions(job, ctx)}
		{@const target = jobTarget(job)}
		{#if isRunning(job) && job.cancellable}
			<Button variant="danger" disabled={cancelling} onclick={() => handleCancel(job, ctx)}>
				{cancelling ? 'Cancelling…' : 'Cancel'}
			</Button>
		{:else if job.rerunnable}
			<Button variant="primary" disabled={rerunning} onclick={() => handleRerun(job, ctx)}>
				{rerunning ? 'Rerunning…' : 'Rerun'}
			</Button>
		{/if}
		{#if target.href}
			<a href={target.href} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm no-underline hover:opacity-90">View Target</a>
		{/if}
	{/snippet}
</EventPanel>
