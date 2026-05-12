<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Site, type Project } from '$api/crud';
	import { getAlarmSummary, type AlarmSummaryResponse } from '$api/service';
	import SiteMap from '$components/dashboard/SiteMap.svelte';

	let projects = $state<Project[]>([]);
	let sites = $state<Site[]>([]);
	let mapExpanded = $state(true);
	let alarms = $state<AlarmSummaryResponse | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			const [p, s, a] = await Promise.all([
				api.projects.list({ perPage: 100 }),
				api.sites.list({ perPage: 100 }),
				getAlarmSummary().catch(() => null),
			]);
			projects = p.data;
			sites = s.data;
			alarms = a;
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Dashboard | River Data</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-xl font-semibold">Dashboard</h2>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else}
		<!-- Stats cards -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[var(--spacing-card-gap)]">
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
				<div class="text-sm text-brand-muted">Projects</div>
				<div class="text-2xl font-semibold mt-1">{projects.length}</div>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
				<div class="text-sm text-brand-muted">Sites</div>
				<div class="text-2xl font-semibold mt-1">{sites.length}</div>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
				<div class="text-sm text-brand-muted">Active Alarms</div>
				<div class="text-2xl font-semibold mt-1 {(alarms?.total ?? 0) > 0 ? 'text-severity-alarm' : 'text-severity-ok'}">
					{alarms?.total ?? 0}
				</div>
			</div>
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
				<div class="text-sm text-brand-muted">Warnings</div>
				<div class="text-2xl font-semibold mt-1 {(alarms?.by_severity.warning ?? 0) > 0 ? 'text-severity-warning' : 'text-severity-ok'}">
					{alarms?.by_severity.warning ?? 0}
				</div>
			</div>
		</div>

		<!-- Map -->
		{#if sites.some((s) => s.latitude && s.longitude)}
			<div>
				<button onclick={() => mapExpanded = !mapExpanded} class="text-sm text-brand-muted bg-transparent border-none cursor-pointer hover:text-brand-text mb-2">
					{mapExpanded ? '▼' : '▶'} Site Map
				</button>
				{#if mapExpanded}
					<SiteMap {sites} height="300px" />
				{/if}
			</div>
		{/if}

		<!-- Sites by project -->
		{#each projects as project}
			<div>
				<h3 class="text-base font-semibold mb-2">{project.name}</h3>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--spacing-card-gap)]">
					{#each sites.filter((s) => s.project_id === project.id) as site}
						<a
							href="/admin/sites/{site.id}"
							class="rounded-md border border-brand-divider bg-brand-surface p-4 no-underline text-brand-text hover:border-brand-primary transition-colors"
						>
							<div class="font-semibold">{site.name}</div>
							{#if site.description}
								<div class="text-sm text-brand-muted mt-1">{site.description}</div>
							{/if}
							{#if site.latitude && site.longitude}
								<div class="text-xs text-brand-muted mt-2 font-mono">
									{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
									{#if site.altitude_m}· {site.altitude_m}m{/if}
								</div>
							{/if}
						</a>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
