<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Site, type Project } from '$api/crud';
	import { formatRelativeTime } from '$lib/utils';

	let sites = $state<Site[]>([]);
	let projects = $state<Project[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let currentPage = $state(1);
	let sortField = $state<string>('name');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchFilter = $state('');

	const perPage = 25;

	async function load() {
		loading = true;
		error = null;
		try {
			const filter: Record<string, unknown> = {};
			if (searchFilter) filter.q = searchFilter;

			const [result, projectResult] = await Promise.all([
				api.sites.list({
					page: currentPage,
					perPage,
					sort: [sortField, sortOrder],
					filter,
				}),
				projects.length === 0 ? api.projects.list({ perPage: 100 }) : Promise.resolve(null),
			]);
			sites = result.data;
			total = result.total;
			if (projectResult) projects = projectResult.data;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load sites';
		} finally {
			loading = false;
		}
	}

	function projectName(id: string): string {
		return projects.find((p) => p.id === id)?.name ?? '—';
	}

	function toggleSort(field: string) {
		if (sortField === field) {
			sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		} else {
			sortField = field;
			sortOrder = 'ASC';
		}
		currentPage = 1;
		load();
	}

	const totalPages = $derived(Math.ceil(total / perPage));

	onMount(load);
</script>

<svelte:head>
	<title>Sites | River Data</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Sites</h2>
		<a
			href="{base}/sites/new"
			class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark"
		>
			Create
		</a>
	</div>

	<!-- Search -->
	<input
		type="text"
		placeholder="Search sites..."
		bind:value={searchFilter}
		oninput={() => { currentPage = 1; load(); }}
		class="w-full max-w-sm px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
	/>

	<!-- Table -->
	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th
						class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary"
						onclick={() => toggleSort('name')}
					>
						Name {sortField === 'name' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}
					</th>
					<th class="text-left px-4 py-2 font-semibold">Project</th>
					<th class="text-left px-4 py-2 font-semibold">Coordinates</th>
					<th
						class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary"
						onclick={() => toggleSort('created_at')}
					>
						Created {sortField === 'created_at' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}
					</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="4" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if error}
					<tr><td colspan="4" class="px-4 py-8 text-center text-severity-alarm">{error}</td></tr>
				{:else if sites.length === 0}
					<tr><td colspan="4" class="px-4 py-8 text-center text-brand-muted">No sites found</td></tr>
				{:else}
					{#each sites as site}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2">
								<a href="{base}/sites/{site.id}" class="text-brand-primary font-semibold no-underline hover:underline">
									{site.name}
								</a>
							</td>
							<td class="px-4 py-2 text-brand-muted">{projectName(site.project_id)}</td>
							<td class="px-4 py-2 text-brand-muted font-mono text-xs">
								{#if site.latitude && site.longitude}
									{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
								{:else}
									—
								{/if}
							</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{formatRelativeTime(site.created_at)}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="flex items-center justify-between text-sm text-brand-muted">
			<span>{total} total</span>
			<div class="flex items-center gap-2">
				<button
					onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }}
					disabled={currentPage <= 1}
					class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default"
				>
					Prev
				</button>
				<span>{currentPage} / {totalPages}</span>
				<button
					onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }}
					disabled={currentPage >= totalPages}
					class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default"
				>
					Next
				</button>
			</div>
		</div>
	{/if}
</div>
