<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Sensor, type ReprocessingJob } from '$api/crud';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';

	let jobs = $state<ReprocessingJob[]>([]);
	let sensorMap = $state<Map<string, string>>(new Map());
	let loading = $state(true);
	let statusFilter = $state<'all' | 'pending' | 'running' | 'completed' | 'failed'>('all');
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function load() {
		loading = true;
		try {
			const filter: Record<string, unknown> = {};
			if (statusFilter !== 'all') filter.status = statusFilter;
			const result = await api.reprocessingJobs.list({
				perPage: 100,
				sort: ['created_at', 'DESC'],
				filter,
			});
			jobs = result.data;
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		const sensors = await api.sensors.list({ perPage: 500 });
		sensorMap = new Map(sensors.data.map((s: Sensor) => [s.id, s.name ?? s.serial_number ?? s.id]));
		await load();
		// Poll every 5 seconds for in-flight jobs
		pollTimer = setInterval(() => {
			if (jobs.some((j) => j.status === 'pending' || j.status === 'running')) {
				load();
			}
		}, 5000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});

	function statusClass(status: string): string {
		switch (status) {
			case 'completed': return 'bg-severity-ok-soft text-severity-ok';
			case 'failed': return 'bg-severity-alarm-soft text-severity-alarm';
			case 'running': return 'bg-severity-warning-soft text-severity-warning';
			case 'pending': return 'bg-brand-bg text-brand-muted';
			default: return 'bg-brand-bg text-brand-muted';
		}
	}

	function sensorName(id: string): string {
		return sensorMap.get(id) ?? id;
	}
</script>

<svelte:head><title>Reprocessing Jobs | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Reprocessing Jobs</h2>
		<button onclick={load} class="px-3 py-1.5 text-sm border border-brand-divider rounded-md bg-brand-surface cursor-pointer hover:bg-brand-bg">Refresh</button>
	</div>

	<div class="flex gap-1">
		{#each ['all', 'pending', 'running', 'completed', 'failed'] as s}
			<button
				onclick={() => { statusFilter = s as typeof statusFilter; load(); }}
				class="px-3 py-1 text-sm rounded-md cursor-pointer border-none {statusFilter === s ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted'}"
			>{s}</button>
		{/each}
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Sensor</th>
					<th class="text-left px-4 py-2 font-semibold">Trigger</th>
					<th class="text-left px-4 py-2 font-semibold">Status</th>
					<th class="text-right px-4 py-2 font-semibold">Readings</th>
					<th class="text-left px-4 py-2 font-semibold">Created</th>
					<th class="text-left px-4 py-2 font-semibold">Completed</th>
					<th class="text-left px-4 py-2 font-semibold">Error</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if jobs.length === 0}
					<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">No jobs</td></tr>
				{:else}
					{#each jobs as job}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="px-4 py-2">
								<a href="{base}/sensors/{job.sensor_id}" class="text-brand-primary no-underline hover:underline">{sensorName(job.sensor_id)}</a>
							</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{job.trigger_type}</td>
							<td class="px-4 py-2">
								<span class="px-2 py-0.5 text-xs font-medium rounded-full {statusClass(job.status)}">{job.status}</span>
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
</div>
