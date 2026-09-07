<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Project } from '$api/crud';
	import CrudList from '$components/crud/CrudList.svelte';
	import type { Column } from '$components/crud/CrudList.svelte';

	const columns: Column[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'description', label: 'Description', class: 'text-brand-muted' },
		{ key: 'public_code', label: 'Public API', sortable: false },
		{ key: 'created_at', label: 'Updated', class: 'text-brand-muted text-xs' },
	];
</script>

<svelte:head>
	<title>Projects | RIVER Data</title>
</svelte:head>

<CrudList
	client={api.projects}
	{columns}
	title="Projects"
	createHref="{base}/projects/new"
	perPage={100}
	defaultSort={['name', 'ASC']}
	emptyText="No projects"
	rowHref={(p: Project) => `${base}/projects/${p.id}`}
>
	{#snippet cell({ column, row, text }: { column: Column; row: Project; text: string })}
		{#if column.key === 'public_code'}
			{#if row.is_public}
				<span
					class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok"
				>
					{row.public_code}
				</span>
			{:else}
				<span class="text-brand-muted text-xs">Disabled</span>
			{/if}
		{:else}
			{text}
		{/if}
	{/snippet}
</CrudList>
