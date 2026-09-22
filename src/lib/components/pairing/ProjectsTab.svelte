<script lang="ts">
	import type { Project } from '$api/crud';
	import NamePicker from '$components/pairing/NamePicker.svelte';
	import ReviewTable, { type ReviewFilter } from '$components/pairing/ReviewTable.svelte';
	import { formatCount } from '$lib/format';
	import type { ObjectDecision } from '$lib/pairing/objectDecisions';

	// The plan's Projects review tab: every project its rows pair onto, created or existing.
	let {
		projects,
		existingProjects,
		onreview,
		onrename,
		projectConflicts,
		onmarkall,
		marking,
		query = $bindable(''),
		filter = $bindable('all'),
		page = $bindable(0),
	}: {
		projects: ObjectDecision[];
		existingProjects: Project[];
		onreview: (project: ObjectDecision, reviewed: boolean) => void;
		/** Point every row on one project at another name, existing or new. */
		onrename: (oldName: string, newName: string) => void;
		/** What this plan cannot apply about a project, as a sentence per finding. */
		projectConflicts: (projectName: string) => string[];
		onmarkall: (reviewed: boolean) => void;
		marking: boolean;
		query?: string;
		filter?: ReviewFilter;
		page?: number;
	} = $props();

	function existingValue(name: string): string | null {
		const match = existingProjects.find((e) => e.name.toLowerCase() === name.toLowerCase());
		return match ? `db:${match.name}` : null;
	}

	const groups = $derived([
		{ label: 'Existing projects', options: existingProjects.map((p) => ({ value: `db:${p.name}`, label: p.name })) },
		{
			label: 'Will be created',
			options: projects.filter((p) => p.create).map((p) => ({ value: `new:${p.name}`, label: `+ ${p.name}` })),
		},
	]);
</script>

{#snippet nameCell(p: ObjectDecision)}
	<div class="w-[260px]">
		<NamePicker
			value={existingValue(p.name) ?? `new:${p.name}`}
			{groups}
			name={p.name}
			status={existingValue(p.name) ? 'existing' : 'new'}
			ariaLabel="Project for {p.name}"
			onpick={(v) => onrename(p.name, v.slice(v.indexOf(':') + 1))}
			onrename={(name) => onrename(p.name, name)}
		/>
	</div>
	{#each projectConflicts(p.name) as message (message)}
		<div class="text-xs text-severity-warning mt-0.5">{message}</div>
	{/each}
{/snippet}

{#snippet sitesCell(p: ObjectDecision)}
	<span class="text-brand-muted">{formatCount(p.siteCount)}</span>
{/snippet}

{#snippet streamsCell(p: ObjectDecision)}
	<span class="text-brand-muted">{formatCount(p.entryCount)}</span>
{/snippet}

<ReviewTable
	rows={projects}
	key={(p) => p.key}
	noun={['project', 'projects']}
	columns={[
		{ label: 'Project', cell: nameCell },
		{ label: 'Sites', align: 'right', cell: sitesCell },
		{ label: 'Streams', align: 'right', cell: streamsCell },
	]}
	searchText={(p) => p.name}
	reviewed={(p) => p.reviewed}
	{onreview}
	{onmarkall}
	{marking}
	empty="This plan pairs nothing."
	bind:query
	bind:filter
	bind:page
/>
