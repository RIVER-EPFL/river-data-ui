<script lang="ts">
	import { formatRelativeTime } from '$lib/utils';
	import type { CrudClient } from '$api/crud';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type T = any;

	export interface Column {
		key: string;
		label: string;
		sortable?: boolean;
		render?: (value: unknown, row: T) => string;
		class?: string;
	}

	let {
		client,
		columns,
		title,
		createHref = '',
		createLabel = 'Create',
		showHeader = true,
		searchable = false,
		perPage = 25,
		defaultSort = ['created_at', 'DESC'] as [string, 'ASC' | 'DESC'],
		filters: externalFilters = {},
		rowHref,
		onrowclick,
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		client: CrudClient<any>;
		columns: Column[];
		title: string;
		createHref?: string;
		createLabel?: string;
		showHeader?: boolean;
		searchable?: boolean;
		perPage?: number;
		defaultSort?: [string, 'ASC' | 'DESC'];
		filters?: Record<string, unknown>;
		rowHref?: (row: T) => string;
		onrowclick?: (row: T) => void;
	} = $props();

	let items = $state<T[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state('');
	let currentPage = $state(1);
	let sortField = $state(defaultSort[0]);
	let sortOrder = $state<'ASC' | 'DESC'>(defaultSort[1]);
	let searchQuery = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const filter: Record<string, unknown> = { ...externalFilters };
			if (searchQuery) filter.q = searchQuery;
			const result = await client.list({
				page: currentPage,
				perPage,
				sort: [sortField, sortOrder],
				filter,
			});
			items = result.data as T[];
			total = result.total;
		} catch (e) {
			items = [];
			total = 0;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function toggleSort(key: string) {
		if (sortField === key) {
			sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		} else {
			sortField = key;
			sortOrder = 'ASC';
		}
		currentPage = 1;
		load();
	}

	function cellValue(col: Column, row: T): string {
		const val = row[col.key];
		if (col.render) return col.render(val, row);
		if (val == null) return 'None';
		if (col.key.endsWith('_at') && typeof val === 'string') return formatRelativeTime(val);
		return String(val);
	}

	export function refresh() {
		load();
	}

	onMount(load);
</script>

<div class="space-y-4">
	{#if showHeader}
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold">{title}</h2>
			{#if createHref}
				<a
					href={createHref}
					class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark"
				>
					{createLabel}
				</a>
			{/if}
		</div>
	{/if}

	{#if error}
		<ErrorNotice message="Failed to load {title.toLowerCase()}: {error}" />
	{/if}

	{#if searchable}
		<input
			type="text"
			placeholder="Search…"
			bind:value={searchQuery}
			oninput={() => { currentPage = 1; load(); }}
			class="w-full max-w-sm px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					{#each columns as col}
						<th
							class="text-left px-4 py-2 font-semibold {col.sortable !== false ? 'cursor-pointer select-none hover:text-brand-primary' : ''} {col.class ?? ''}"
							onclick={() => col.sortable !== false && toggleSort(col.key)}
						>
							{col.label}
							{#if col.sortable !== false && sortField === col.key}
								{sortOrder === 'ASC' ? '↑' : '↓'}
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan={columns.length} class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if items.length === 0}
					<tr><td colspan={columns.length} class="px-4 py-8 text-center text-brand-muted">No items found</td></tr>
				{:else}
					{#each items as row}
						{@const href = rowHref?.(row)}
						<tr
							class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 {href || onrowclick ? 'cursor-pointer' : ''}"
							onclick={() => {
								if (onrowclick) onrowclick(row);
								else if (href) goto(href);
							}}
						>
							{#each columns as col, i}
								<td class="px-4 py-2 {col.class ?? ''}">
									{#if i === 0 && href}
										<a href={href} onclick={(e) => e.stopPropagation()} class="text-brand-primary font-semibold no-underline hover:underline">
											{cellValue(col, row)}
										</a>
									{:else}
										{cellValue(col, row)}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls
		{total}
		page={currentPage}
		{perPage}
		onPageChange={(p) => { currentPage = p; load(); }}
	/>
</div>
