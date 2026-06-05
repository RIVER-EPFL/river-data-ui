<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api, type Site, type Project } from '$api/crud';
	import { getAlarmSummary, type AlarmSummaryResponse } from '$api/service';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import SiteMap, { type SiteStatus } from '$components/dashboard/SiteMap.svelte';

	type SiteSummary = AlarmSummaryResponse['by_site'][number];

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

	const summaryBySite = $derived.by(() => {
		const map = new Map<string, SiteSummary>();
		for (const entry of alarms?.by_site ?? []) map.set(entry.site_id, entry);
		return map;
	});

	function siteAlarmSeverity(siteId: string): 'ok' | 'warning' | 'alarm' {
		const entry = summaryBySite.get(siteId);
		if (!entry) return 'ok';
		if (entry.alarm_count > 0) return 'alarm';
		if (entry.warning_count > 0) return 'warning';
		return 'ok';
	}

	const statusBySite = $derived.by(() => {
		const projectName = new Map(projects.map((p) => [p.id, p.name]));
		const result = new Map<string, SiteStatus>();
		for (const s of sites) {
			const entry = alarms?.by_site.find((row) => row.site_id === s.id);
			const alarmCount = entry?.alarm_count ?? 0;
			const warningCount = entry?.warning_count ?? 0;
			result.set(s.id, {
				severity: alarmCount > 0 ? 'alarm' : warningCount > 0 ? 'warning' : 'ok',
				alarmCount,
				warningCount,
				latestReadingTime: entry?.latest_reading_time ?? null,
				projectName: projectName.get(s.project_id) ?? null,
			});
		}
		return result;
	});

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
					statusBySite={statusBySite}
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
						<h3 class="text-sm font-semibold mb-1"><a href="{base}/projects/{project.id}" class="text-brand-muted no-underline hover:underline hover:text-brand-primary">{project.name}</a></h3>
						<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-brand-divider">
										<th class="px-4 py-1.5 text-left text-xs font-medium text-brand-muted">Site</th>
										<th class="px-4 py-1.5 text-right text-xs font-medium text-brand-muted">Last data</th>
										<th class="px-4 py-1.5 text-right text-xs font-medium text-brand-muted">Last alarm</th>
										<th class="px-4 py-1.5 text-right text-xs font-medium text-brand-muted">Last warning</th>
									</tr>
								</thead>
								<tbody>
									{#each projectSites as site}
										{@const severity = siteAlarmSeverity(site.id)}
										{@const entry = summaryBySite.get(site.id)}
										<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
											<td class="px-4 py-2">
												<span class="inline-block w-2.5 h-2.5 rounded-full mr-2 {severity === 'alarm' ? 'bg-severity-alarm' : severity === 'warning' ? 'bg-severity-warning' : 'bg-severity-ok'}"></span>
												<a href="{base}/sites/{site.id}" class="font-semibold text-brand-primary no-underline hover:underline">{site.name}</a>
												{#if site.description}<span class="text-brand-muted ml-2">{site.description}</span>{/if}
												{#if !site.latitude || !site.longitude}
													<span class="text-xs text-severity-warning ml-2">no coords</span>
												{/if}
											</td>
											<td class="px-4 py-2 text-right">
												{#if entry?.latest_reading_time}
													<a href="{base}/sites/{site.id}" title={formatDateTime(entry.latest_reading_time)} class="text-xs text-brand-primary no-underline hover:underline">{formatRelativeTime(entry.latest_reading_time)}</a>
												{:else}
													<span class="text-xs text-brand-muted">—</span>
												{/if}
											</td>
											<td class="px-4 py-2 text-right">
												{#if entry?.last_alarm_at}
													<a href="{base}/alarms?site_id={site.id}&severity=alarm" title={formatDateTime(entry.last_alarm_at)} class="text-xs text-brand-primary no-underline hover:underline">{formatRelativeTime(entry.last_alarm_at)}</a>
												{:else}
													<span class="text-xs text-brand-muted">—</span>
												{/if}
											</td>
											<td class="px-4 py-2 text-right">
												{#if entry?.last_warning_at}
													<a href="{base}/alarms?site_id={site.id}&severity=warning" title={formatDateTime(entry.last_warning_at)} class="text-xs text-brand-primary no-underline hover:underline">{formatRelativeTime(entry.last_warning_at)}</a>
												{:else}
													<span class="text-xs text-brand-muted">—</span>
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
