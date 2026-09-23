<script module lang="ts">
	import type { Snippet } from 'svelte';

	/** Rows one page holds, shared so a caller can turn to the page a row is on. */
	export const REVIEW_ROWS_PER_PAGE = 25;

	export type ReviewFilter = 'all' | 'needs_review' | 'reviewed';

	export interface ReviewColumn<T> {
		label: string;
		title?: string;
		align?: 'left' | 'right';
		width?: string;
		cell: Snippet<[T]>;
	}
</script>

<script lang="ts" generics="T">
	import Button from '$components/ui/Button.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import PairSkipToggle from '$components/ui/PairSkipToggle.svelte';
	import ReviewButton from '$components/pairing/ReviewButton.svelte';
	import { formatCount } from '$lib/format';

	// The table every tab of the pairing review is drawn with: the same toolbar, the thing's name
	// first, then its details, then Pair and Review, and the same paging.
	let {
		rows,
		key,
		rowId,
		noun,
		columns,
		searchText,
		reviewed,
		reviewBlocked,
		onreview,
		pairing,
		muted,
		detail,
		expanded,
		ontoggle,
		onmarkall,
		marking = false,
		canMarkUnreviewed,
		empty,
		query = $bindable(''),
		filter = $bindable('all'),
		page = $bindable(0),
	}: {
		rows: T[];
		key: (row: T) => string;
		rowId?: (row: T) => string;
		/** What one row is, singular and plural, for the count. */
		noun: [string, string];
		columns: ReviewColumn<T>[];
		searchText: (row: T) => string;
		/** Null for a row with nothing to review, such as one that is skipped. */
		reviewed?: (row: T) => boolean | null;
		reviewBlocked?: (row: T) => string | null;
		onreview?: (row: T, reviewed: boolean) => void;
		pairing?: {
			value: (row: T) => 'pair' | 'skip' | 'mixed';
			onchange: (row: T, action: 'pair' | 'skip') => void;
			title: (row: T) => string;
		};
		muted?: (row: T) => boolean;
		/** What a row opens onto, under it. */
		detail?: Snippet<[T]>;
		expanded?: (row: T) => boolean;
		ontoggle?: (row: T) => void;
		/** Mark every row of the tab reviewed or unreviewed, whatever the search and filter show. */
		onmarkall?: (reviewed: boolean) => void;
		marking?: boolean;
		/** Overrides the count of reviewed rows, where some cannot be taken back. */
		canMarkUnreviewed?: boolean;
		empty: string;
		query?: string;
		filter?: ReviewFilter;
		page?: number;
	} = $props();

	const states = $derived(reviewed ? rows.map((r) => reviewed(r)) : []);
	const openCount = $derived(states.filter((s) => s === false).length);
	const doneCount = $derived(states.filter((s) => s === true).length);

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return rows.filter((row) => {
			if (q && !searchText(row).toLowerCase().includes(q)) return false;
			if (!reviewed || filter === 'all') return true;
			return reviewed(row) === (filter === 'reviewed');
		});
	});
	const totalPages = $derived(Math.max(1, Math.ceil(shown.length / REVIEW_ROWS_PER_PAGE)));
	const current = $derived(Math.min(page, totalPages - 1));
	const paged = $derived(shown.slice(current * REVIEW_ROWS_PER_PAGE, (current + 1) * REVIEW_ROWS_PER_PAGE));
	const span = $derived(columns.length + (detail ? 1 : 0) + (pairing ? 1 : 0) + (reviewed ? 1 : 0));

	const filters: Array<[ReviewFilter, string]> = [
		['all', 'All'],
		['needs_review', 'Needs review'],
		['reviewed', 'Reviewed'],
	];
	const filterCount = (f: ReviewFilter) => (f === 'all' ? rows.length : f === 'reviewed' ? doneCount : openCount);
</script>

<div class="space-y-2">
	<div class="flex flex-wrap items-center gap-2">
		<input
			type="search"
			placeholder="Search {noun[1]}…"
			bind:value={query}
			oninput={() => (page = 0)}
			aria-label="Search {noun[1]}"
			class="w-64 px-3 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		{#if reviewed}
			<div class="flex gap-1">
				{#each filters as [value, label] (value)}
					<button
						onclick={() => { filter = value; page = 0; }}
						class="px-2 py-0.5 text-xs rounded cursor-pointer border-none {filter === value ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
					>{label} {formatCount(filterCount(value))}</button>
				{/each}
			</div>
		{/if}
		<span class="text-xs text-brand-muted">
			{formatCount(shown.length)} {shown.length === 1 ? noun[0] : noun[1]}
		</span>
		{#if reviewed && onmarkall}
			<div class="ml-auto flex gap-1">
				<Button
					size="sm"
					variant="ghost"
					disabled={marking || !(canMarkUnreviewed ?? doneCount > 0)}
					onclick={() => onmarkall(false)}
				>Mark all unreviewed</Button>
				<Button size="sm" disabled={marking || openCount === 0} onclick={() => onmarkall(true)}>
					Mark all reviewed
				</Button>
			</div>
		{/if}
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead><tr class="bg-brand-bg border-b border-brand-divider">
				{#if detail}<th class="w-8"></th>{/if}
				{#each columns as c (c.label)}
					<th
						class="px-3 py-2 font-semibold {c.align === 'right' ? 'text-right' : 'text-left'} {c.width ?? ''}"
						title={c.title}
					>{c.label}</th>
				{/each}
				{#if pairing}<th class="px-3 py-2 font-semibold text-right w-28">Pair</th>{/if}
				{#if reviewed}<th class="px-3 py-2 font-semibold text-right w-32">Review</th>{/if}
			</tr></thead>
			<tbody>
				{#each paged as row (key(row))}
					{@const open = expanded?.(row) ?? false}
					{@const state = reviewed?.(row) ?? null}
					<tr
						id={rowId?.(row)}
						class="border-b border-brand-divider last:border-b-0 align-top hover:bg-brand-bg/50 {muted?.(row) ? 'opacity-50' : ''}"
					>
						{#if detail}
							<td class="pl-3 py-2">
								<button
									onclick={() => ontoggle?.(row)}
									aria-label={open ? 'Collapse' : 'Expand'}
									aria-expanded={open}
									class="bg-transparent border-none cursor-pointer text-brand-muted text-xs p-0 mt-1.5"
								>{open ? '▼' : '▶'}</button>
							</td>
						{/if}
						{#each columns as c (c.label)}
							<td class="px-3 py-2 {c.align === 'right' ? 'text-right' : ''}">{@render c.cell(row)}</td>
						{/each}
						{#if pairing}
							<td class="px-3 py-2 text-right">
								<div class="inline-flex justify-end">
									<PairSkipToggle
										value={pairing.value(row)}
										onchange={(a) => pairing.onchange(row, a)}
										title={pairing.title(row)}
									/>
								</div>
							</td>
						{/if}
						{#if reviewed}
							<td class="px-3 py-2 text-right">
								{#if state !== null}
									<ReviewButton
										reviewed={state}
										blocked={reviewBlocked?.(row) ?? null}
										onclick={() => onreview?.(row, !state)}
									/>
								{/if}
							</td>
						{/if}
					</tr>
					{#if detail && open}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td colspan={span} class="p-0 bg-brand-bg/30">{@render detail(row)}</td>
						</tr>
					{/if}
				{/each}
				{#if paged.length === 0}
					<tr><td colspan={span} class="px-4 py-8 text-center text-brand-muted text-sm">
						{rows.length === 0 ? empty : `No ${noun[1]} match`}
					</td></tr>
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls total={shown.length} page={current + 1} perPage={REVIEW_ROWS_PER_PAGE} onPageChange={(p) => (page = p - 1)} />
</div>
