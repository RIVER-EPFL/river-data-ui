<script lang="ts">
	import { formatRelativeTime } from '$lib/utils';
	import type { CrudClient } from '$api/crud';
	import { goto } from '$app/navigation';
	import { onMount, type Snippet } from 'svelte';
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

	/** What one page of a list costs to fetch: the shape `CrudClient.list` already returns. */
	export interface PageRequest {
		page: number;
		perPage: number;
		sort: [string, 'ASC' | 'DESC'];
		filter: Record<string, unknown>;
	}
	export type PageLoader<R> = (params: PageRequest) => Promise<{ data: R[]; total: number }>;

	let {
		client,
		load: loadPage,
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
		emptyText = 'No items found',
		cell,
		actions,
		actionsLabel = '',
		filterBar,
		footer,
		header,
		rowClass,
		rowDetail,
		empty,
	}: {
		/** The entity's CRUD client. Omit it and pass `load` for a list that is not one entity. */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		client?: CrudClient<any>;
		/** One page of rows, however they are assembled. Defaults to `client.list`. */
		load?: PageLoader<T>;
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
		emptyText?: string;
		/** Renders every cell. `text` is the default rendering, to fall back to per column. */
		cell?: Snippet<[{ column: Column; row: T; value: unknown; text: string }]>;
		/** A trailing column of per-row controls. */
		actions?: Snippet<[T]>;
		actionsLabel?: string;
		/** Controls above the table. A filter change calls `reload`, which returns to page one. */
		filterBar?: Snippet<[{ reload: () => void }]>;
		/** A line under the pagination, for a count the list itself cannot know. */
		footer?: Snippet;
		/** Renders every header cell. `label` is the default, to fall back to per column. */
		header?: Snippet<[{ column: Column; label: string }]>;
		rowClass?: (row: T) => string;
		/** Extra rows under a row, expanding it. The snippet writes its own `<tr>`. */
		rowDetail?: Snippet<[{ row: T; colCount: number }]>;
		/** Replaces the whole table when the list is empty, for a call to action `emptyText` cannot carry. */
		empty?: Snippet;
	} = $props();

	const fetchPage: PageLoader<T> = (params) => {
		if (loadPage) return loadPage(params);
		if (client) return client.list(params) as Promise<{ data: T[]; total: number }>;
		throw new Error('CrudList needs either a client or a load function');
	};

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
			const result = await fetchPage({
				page: currentPage,
				perPage,
				sort: [sortField, sortOrder],
				filter,
			});
			items = result.data;
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

	const colCount = $derived(columns.length + (actions ? 1 : 0));

	/** A filter change is a new list, so it returns to page one. */
	export function reload() {
		currentPage = 1;
		load();
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

	{#if filterBar}
		<div class="flex flex-wrap items-center gap-2">
			{@render filterBar({ reload })}
		</div>
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

	{#if empty && !loading && items.length === 0}
		{@render empty()}
	{:else}
	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					{#each columns as col}
						<th
							class="text-left px-4 py-2 font-semibold {col.sortable !== false ? 'cursor-pointer select-none hover:text-brand-primary' : ''} {col.class ?? ''}"
							onclick={() => col.sortable !== false && toggleSort(col.key)}
						>
							{#if header}
								{@render header({ column: col, label: col.label })}
							{:else}
								{col.label}
							{/if}
							{#if col.sortable !== false && sortField === col.key}
								{sortOrder === 'ASC' ? '↑' : '↓'}
							{/if}
						</th>
					{/each}
					{#if actions}
						<th class="text-left px-4 py-2 font-semibold">{actionsLabel}</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan={colCount} class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if items.length === 0}
					<tr><td colspan={colCount} class="px-4 py-8 text-center text-brand-muted">{emptyText}</td></tr>
				{:else}
					{#each items as row}
						{@const href = rowHref?.(row)}
						<tr
							class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 {href || onrowclick ? 'cursor-pointer' : ''} {rowClass?.(row) ?? ''}"
							onclick={() => {
								if (onrowclick) onrowclick(row);
								else if (href) goto(href);
							}}
						>
							{#each columns as col, i}
								{@const text = cellValue(col, row)}
								<td class="px-4 py-2 {col.class ?? ''}">
									{#if i === 0 && href}
										<a href={href} onclick={(e) => e.stopPropagation()} class="text-brand-primary font-semibold no-underline hover:underline">
											{text}
										</a>
									{:else if cell}
										{@render cell({ column: col, row, value: row[col.key], text })}
									{:else}
										{text}
									{/if}
								</td>
							{/each}
							{#if actions}
								<!-- A control in this cell acts on its row; it never also follows the row's link. -->
								<td class="px-4 py-2" onclick={(e) => e.stopPropagation()}>
									{@render actions(row)}
								</td>
							{/if}
						</tr>
						{#if rowDetail}
							{@render rowDetail({ row, colCount })}
						{/if}
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	{/if}

	<PaginationControls
		{total}
		page={currentPage}
		{perPage}
		onPageChange={(p) => { currentPage = p; load(); }}
	/>

	{#if footer}
		<p class="text-xs text-brand-muted">{@render footer()}</p>
	{/if}
</div>
