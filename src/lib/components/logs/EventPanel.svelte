<script lang="ts" generics="T">
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	interface DetailCtx {
		close: () => void;
		reload: () => Promise<void>;
	}

	let {
		fetchPage,
		perPage = 100,
		colCount,
		head,
		row,
		filterBar,
		pollWhile,
		emptyText = 'No entries',
		onRowClick,
		onOpenDetail,
		detailTitle = 'Detail',
		detailMaxWidth = 'sm',
		detail,
		detailActions,
		rowClass,
	}: {
		fetchPage: (args: { page: number; perPage: number }) => Promise<{ data: T[]; total: number }>;
		perPage?: number;
		colCount: number;
		// Snippets declared with no params remain assignable; take the ctx only when needed
		// (e.g. a sortable header that re-fetches server-side).
		head: Snippet<[{ reload: () => Promise<void> }]>;
		row: Snippet<[T]>;
		rowClass?: (item: T) => string;
		filterBar?: Snippet<[{ reload: () => Promise<void> }]>;
		pollWhile?: (items: T[]) => boolean;
		emptyText?: string;
		onRowClick?: (item: T) => void;
		onOpenDetail?: (item: T) => void | Promise<void>;
		detailTitle?: string;
		detailMaxWidth?: 'sm' | 'md' | 'lg';
		detail?: Snippet<[T, DetailCtx]>;
		detailActions?: Snippet<[T, DetailCtx]>;
	} = $props();

	let items = $state<T[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state('');
	let currentPage = $state(1);

	let selected = $state<T | null>(null);
	let detailOpen = $state(false);

	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function load() {
		loading = true;
		error = '';
		try {
			const result = await fetchPage({ page: currentPage, perPage });
			items = result.data;
			total = result.total;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load';
			items = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	// Filter changes reset to the first page; pagination keeps the current page.
	export async function reload() {
		currentPage = 1;
		await load();
	}

	const ctx: DetailCtx = {
		close: () => (detailOpen = false),
		reload: load,
	};

	function handleRow(item: T) {
		if (onRowClick) {
			onRowClick(item);
			return;
		}
		selected = item;
		detailOpen = true;
		void onOpenDetail?.(item);
	}

	onMount(async () => {
		await load();
		if (pollWhile) {
			pollTimer = setInterval(() => {
				if (pollWhile(items)) load();
			}, 5000);
		}
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

<div class="space-y-4">
	{#if filterBar}
		<div class="flex items-center justify-between gap-2 flex-wrap">
			{@render filterBar({ reload })}
		</div>
	{/if}

	{#if error}
		<ErrorNotice message={error} />
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					{@render head({ reload })}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan={colCount} class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if items.length === 0}
					<tr><td colspan={colCount} class="px-4 py-8 text-center text-brand-muted">{emptyText}</td></tr>
				{:else}
					{#each items as item}
						<tr
							class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer {rowClass?.(item) ?? ''}"
							onclick={() => handleRow(item)}
						>
							{@render row(item)}
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

{#if detail}
	<Dialog bind:open={detailOpen} title={detailTitle} maxWidth={detailMaxWidth}>
		{#snippet children()}
			{#if selected}{@render detail(selected, ctx)}{/if}
		{/snippet}
		{#snippet actions()}
			{#if selected && detailActions}{@render detailActions(selected, ctx)}{/if}
			<Button onclick={() => (detailOpen = false)}>Close</Button>
		{/snippet}
	</Dialog>
{/if}
