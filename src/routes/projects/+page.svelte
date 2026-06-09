<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type Project } from '$api/crud';
	import { formatRelativeTime } from '$lib/utils';

	let projects = $state<Project[]>([]);
	let total = $state(0);
	let loading = $state(true);

	onMount(async () => {
		try {
			const result = await api.projects.list({ perPage: 100, sort: ['name', 'ASC'] });
			projects = result.data;
			total = result.total;
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Projects | River Data</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Projects</h2>
		<a
			href="{base}/projects/new"
			class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark"
		>
			Create
		</a>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Name</th>
					<th class="text-left px-4 py-2 font-semibold">Description</th>
					<th class="text-left px-4 py-2 font-semibold">Public API</th>
					<th class="text-left px-4 py-2 font-semibold">Updated</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="4" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if projects.length === 0}
					<tr><td colspan="4" class="px-4 py-8 text-center text-brand-muted">No projects</td></tr>
				{:else}
					{#each projects as project}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2">
								<a href="{base}/projects/{project.id}" class="text-brand-primary font-semibold no-underline hover:underline">
									{project.name}
								</a>
							</td>
							<td class="px-4 py-2 text-brand-muted">{project.description ?? 'None'}</td>
							<td class="px-4 py-2">
								{#if project.is_public}
									<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">
										{project.public_code}
									</span>
								{:else}
									<span class="text-brand-muted text-xs">Disabled</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{formatRelativeTime(project.created_at)}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>
