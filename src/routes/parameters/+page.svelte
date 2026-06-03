<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { api, type Parameter } from '$api/crud';
	import { formatRelativeTime } from '$lib/utils';

	let parameters = $state<Parameter[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let currentPage = $state(1);
	let sortField = $state('code');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchQuery = $state('');
	let categoryFilter = $state('');
	let categories = $state<string[]>([]);
	let derivedOutputIds = $state<Set<string>>(new Set());

	const perPage = 25;
	const totalPages = $derived(Math.ceil(total / perPage));

	async function load() {
		loading = true;
		try {
			const filter: Record<string, unknown> = {};
			if (searchQuery) filter.q = searchQuery;
			if (categoryFilter) filter.category = categoryFilter;

			const result = await api.parameters.list({
				page: currentPage, perPage,
				sort: [sortField, sortOrder],
				filter,
			});
			parameters = result.data;
			total = result.total;

			if (categories.length === 0) {
				const all = await api.parameters.list({ perPage: 500 });
				categories = [...new Set(all.data.map((p) => p.category))].sort();
			}

			if (derivedOutputIds.size === 0) {
				const derived = await api.derivedParameters.list({ perPage: 500 });
				derivedOutputIds = new Set(
					derived.data.map((d) => d.output_parameter_id).filter((id): id is string => !!id)
				);
			}
		} finally {
			loading = false;
		}
	}

	function toggleSort(field: string) {
		if (sortField === field) sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		else { sortField = field; sortOrder = 'ASC'; }
		currentPage = 1;
		load();
	}

	onMount(load);
</script>

<svelte:head><title>Parameters | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Parameters</h2>
		<a href="{base}/parameters/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create</a>
	</div>

	<div class="flex gap-3 items-center flex-wrap">
		<input
			type="text" placeholder="Search parameters..." bind:value={searchQuery}
			oninput={() => { currentPage = 1; load(); }}
			class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		<select
			bind:value={categoryFilter}
			onchange={() => { currentPage = 1; load(); }}
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="">All categories</option>
			{#each categories as cat}
				<option value={cat}>{cat}</option>
			{/each}
		</select>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					{#each [['code', 'Code'], ['name', 'Name'], ['default_units', 'Unit'], ['category', 'Category'], ['created_at', 'Created']] as [key, label]}
						<th class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary" onclick={() => toggleSort(key)}>
							{label} {sortField === key ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="5" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if parameters.length === 0}
					<tr><td colspan="5" class="px-4 py-8 text-center text-brand-muted">No parameters found</td></tr>
				{:else}
					{#each parameters as param}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2"><a href="{base}/parameters/{param.id}" class="text-brand-primary font-semibold font-mono no-underline hover:underline">{param.code}</a></td>
							<td class="px-4 py-2">
								{param.name}
								{#if derivedOutputIds.has(param.id)}
									<span class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent align-middle">derived</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-brand-muted">{param.default_units || '—'}</td>
							<td class="px-4 py-2"><span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">{param.category}</span></td>
							<td class="px-4 py-2 text-brand-muted text-xs">{formatRelativeTime(param.created_at)}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between text-sm text-brand-muted">
			<span>{total} total</span>
			<div class="flex items-center gap-2">
				<button onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }} disabled={currentPage <= 1} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Prev</button>
				<span>{currentPage} / {totalPages}</span>
				<button onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }} disabled={currentPage >= totalPages} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Next</button>
			</div>
		</div>
	{/if}
</div>
