<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Project, type Site } from '$api/crud';
	import { invalidatePublicConfig } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Tabs from '$components/ui/Tabs.svelte';

	let project = $state<Project | null>(null);
	let sites = $state<Site[]>([]);
	let loading = $state(true);
	let activeTab = $state(0);

	const projectId = page.params.id!;

	onMount(async () => {
		try {
			const [p, s] = await Promise.all([
				api.projects.get(projectId),
				api.sites.list({ perPage: 100, filter: { project_id: projectId } }),
			]);
			project = p;
			sites = s.data;
		} finally {
			loading = false;
		}
	});

	async function handleInvalidateCache() {
		if (!project?.public_api_slug) return;
		try {
			await invalidatePublicConfig(project.public_api_slug);
			toastStore.success('Public API cache invalidated');
		} catch {
			toastStore.error('Failed to invalidate cache');
		}
	}
</script>

<svelte:head><title>{project?.name ?? 'Project'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if project}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<a href="{base}/projects" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Projects</a>
				<h2 class="text-xl font-semibold mt-1">{project.name}</h2>
			</div>
			<a href="{base}/projects/{project.id}/edit" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
		</div>

		<Tabs tabs={['Overview', 'Sites', 'Public API']} bind:active={activeTab} />

		{#if activeTab === 0}
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
				<div><span class="text-sm text-brand-muted">Description</span><p class="text-sm">{project.description ?? '—'}</p></div>
				<div><span class="text-sm text-brand-muted">Created</span><p class="text-sm">{new Date(project.created_at).toLocaleString()}</p></div>
			</div>
		{:else if activeTab === 1}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Name</th>
						<th class="text-left px-4 py-2 font-semibold">Coordinates</th>
					</tr></thead>
					<tbody>
						{#each sites as site}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2"><a href="{base}/sites/{site.id}" class="text-brand-primary no-underline hover:underline">{site.name}</a></td>
								<td class="px-4 py-2 text-brand-muted font-mono text-xs">{site.latitude?.toFixed(4) ?? '—'}, {site.longitude?.toFixed(4) ?? ''}</td>
							</tr>
						{/each}
						{#if sites.length === 0}
							<tr><td colspan="2" class="px-4 py-6 text-center text-brand-muted">No sites</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		{:else if activeTab === 2}
			<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium">Public API</span>
					{#if project.public_api_enabled}
						<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">Enabled</span>
					{:else}
						<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">Disabled</span>
					{/if}
				</div>
				{#if project.public_api_slug}
					<div>
						<span class="text-sm text-brand-muted">Slug</span>
						<p class="text-sm font-mono">{project.public_api_slug}</p>
					</div>
					<div>
						<span class="text-sm text-brand-muted">Public URL</span>
						<p class="text-sm font-mono">/api/public/{project.public_api_slug}</p>
					</div>
					<div class="flex gap-2 pt-2">
						<button onclick={handleInvalidateCache} class="px-3 py-1.5 text-sm border border-brand-divider rounded-md bg-brand-surface cursor-pointer hover:bg-brand-bg">Invalidate Cache</button>
						<a href="/api/public/{project.public_api_slug}/docs" target="_blank" class="px-3 py-1.5 text-sm border border-brand-divider rounded-md bg-brand-surface no-underline text-brand-text hover:bg-brand-bg">View API Docs</a>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
