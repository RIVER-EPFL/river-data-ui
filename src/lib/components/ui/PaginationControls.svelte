<script lang="ts">
	import Button from '$components/ui/Button.svelte';

	let {
		total,
		page,
		perPage,
		onPageChange,
	}: {
		total: number;
		page: number;
		perPage: number;
		onPageChange: (page: number) => void;
	} = $props();

	const totalPages = $derived(Math.max(1, Math.ceil(total / perPage)));
</script>

{#if total > 0}
	<div class="flex items-center justify-between text-sm text-brand-muted">
		<span>{total} total</span>
		{#if totalPages > 1}
			<div class="flex items-center gap-2">
				<Button size="sm" disabled={page <= 1} onclick={() => onPageChange(Math.max(1, page - 1))}>
					Prev
				</Button>
				<span>{page} / {totalPages}</span>
				<Button size="sm" disabled={page >= totalPages} onclick={() => onPageChange(Math.min(totalPages, page + 1))}>
					Next
				</Button>
			</div>
		{/if}
	</div>
{/if}
