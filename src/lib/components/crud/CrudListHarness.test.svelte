<script lang="ts">
	import CrudList from './CrudList.svelte';
	import type { Column, PageLoader } from './CrudList.svelte';

	let {
		load,
		columns,
		withCell = false,
		withActions = false,
		withDetail = false,
		withEmpty = false,
		defaultSort,
	}: {
		load: PageLoader<Record<string, unknown>>;
		columns: Column[];
		withCell?: boolean;
		withActions?: boolean;
		withDetail?: boolean;
		withEmpty?: boolean;
		defaultSort?: [string, 'ASC' | 'DESC'];
	} = $props();
</script>

<CrudList
	{load}
	{columns}
	{defaultSort}
	title="Widgets"
	showHeader={false}
	cell={withCell ? cell : undefined}
	actions={withActions ? actions : undefined}
	rowDetail={withDetail ? rowDetail : undefined}
	empty={withEmpty ? empty : undefined}
	actionsLabel="Do"
/>

{#snippet rowDetail({ row, colCount }: { row: Record<string, unknown>; colCount: number })}
	<tr><td colspan={colCount}>Detail for {row.name}</td></tr>
{/snippet}

{#snippet empty()}
	<p>Nothing here yet</p>
{/snippet}

{#snippet cell({ column, text }: { column: Column; text: string })}
	{#if column.key === 'name'}<strong>{text}</strong>{:else}{text}{/if}
{/snippet}

{#snippet actions(row: Record<string, unknown>)}
	<button>Edit {row.name}</button>
{/snippet}
