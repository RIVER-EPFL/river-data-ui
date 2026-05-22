<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api, type Site, type Project } from '$api/crud';
	import { getAlarmSummary, type AlarmSummaryResponse } from '$api/service';
	import SiteMap from '$components/dashboard/SiteMap.svelte';

	let projects = $state<Project[]>([]);
	let sites = $state<Site[]>([]);
	let alarms = $state<AlarmSummaryResponse | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let filterProjectId = $state<string | undefined>(undefined);

	const missingCoordsCount = $derived(sites.filter((s) => !s.latitude || !s.longitude).length);
	const hasMapSites = $derived(sites.some((s) => s.latitude && s.longitude));

	const filteredSites = $derived(
		filterProjectId ? sites.filter((s) => s.project_id === filterProjectId) : sites,
	);

	function siteAlarmSeverity(siteId: string): 'ok' | 'warning' | 'alarm' {
		if (!alarms) return 'ok';
		const entry = alarms.by_site.find((s) => s.site_id === siteId);
		if (!entry) return 'ok';
		if (entry.alarm_count > 0) return 'alarm';
		if (entry.warning_count > 0) return 'warning';
		return 'ok';
	}

	function siteStatus(siteId: string) {
		const entry = alarms?.by_site.find((s) => s.site_id === siteId);
		const site = sites.find((s) => s.id === siteId);
		const project = site ? projects.find((p) => p.id === site.project_id) : undefined;
		const alarmCount = entry?.alarm_count ?? 0;
		const warningCount = entry?.warning_count ?? 0;
		const severity: 'ok' | 'warning' | 'alarm' =
			alarmCount > 0 ? 'alarm' : warningCount > 0 ? 'warning' : 'ok';
		return {
			severity,
			alarmCount,
			warningCount,
			latestReadingTime: entry?.latest_reading_time ?? null,
			projectName: project?.name ?? null,
		};
	}

	function onSiteClick(siteId: string) {
		goto(`${base}/sites/${siteId}`);
	}

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
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load dashboard';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Dashboard | River Data</title>
</svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-semibold">Dashboard</h2>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else if error}
		<p class="text-severity-alarm">{error}</p>
	{:else}
		{#if sites.length > 0}
			<!-- Project filter + info -->
			<div class="flex items-center justify-between flex-wrap gap-2">
				<div class="flex gap-1.5 flex-wrap">
					<button
						onclick={() => filterProjectId = undefined}
						class="px-2.5 py-1 text-xs rounded-full cursor-pointer border-none {!filterProjectId ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>All ({sites.length})</button>
					{#each projects as project}
						{@const count = sites.filter((s) => s.project_id === project.id).length}
						<button
							onclick={() => filterProjectId = filterProjectId === project.id ? undefined : project.id}
							class="px-2.5 py-1 text-xs rounded-full cursor-pointer border-none {filterProjectId === project.id ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
						>{project.name} ({count})</button>
					{/each}
				</div>
				{#if missingCoordsCount > 0}
					<span class="text-xs text-severity-warning">{missingCoordsCount} of {sites.length} site{sites.length === 1 ? '' : 's'} missing coordinates</span>
				{/if}
			</div>

			<!-- Map -->
			{#if hasMapSites}
				<SiteMap
					sites={filteredSites}
					{filterProjectId}
					height="450px"
					onSiteClick={onSiteClick}
					siteStatus={siteStatus}
				/>
			{:else}
				<div class="h-[200px] rounded-md border border-brand-divider bg-brand-bg flex items-center justify-center text-sm text-brand-muted">
					No sites have coordinates yet. Add coordinates via site edit to see them on the map.
				</div>
			{/if}

			<!-- Site list grouped by project -->
			{#each projects.filter((p) => !filterProjectId || p.id === filterProjectId) as project}
				{@const projectSites = filteredSites.filter((s) => s.project_id === project.id)}
				{#if projectSites.length > 0}
					<div>
						<h3 class="text-sm font-semibold text-brand-muted mb-1">{project.name}</h3>
						<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
							<table class="w-full text-sm">
								<tbody>
									{#each projectSites as site}
										{@const severity = siteAlarmSeverity(site.id)}
										<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
											<td class="px-4 py-2">
												<span class="inline-block w-2.5 h-2.5 rounded-full mr-2 {severity === 'alarm' ? 'bg-severity-alarm' : severity === 'warning' ? 'bg-severity-warning' : 'bg-severity-ok'}"></span>
												<a href="{base}/sites/{site.id}" class="font-semibold text-brand-primary no-underline hover:underline">{site.name}</a>
												{#if site.description}<span class="text-brand-muted ml-2">{site.description}</span>{/if}
											</td>
											<td class="px-4 py-2 text-right">
												{#if site.latitude && site.longitude}
													<span class="text-xs font-mono text-brand-muted">{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}{site.altitude_m ? ` (${site.altitude_m}m)` : ''}</span>
												{:else}
													<span class="text-xs text-severity-warning">No coordinates</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			{/each}
		{:else}
			<p class="text-brand-muted">No sites configured yet.</p>
		{/if}
	{/if}
</div>
