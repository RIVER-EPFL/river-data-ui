<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '$components/ui/Button.svelte';

	let {
		title,
		removable,
		onremove,
		controls,
		chart,
		footer,
	}: {
		title: string;
		removable: boolean;
		onremove: () => void;
		controls: Snippet;
		chart: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
	<div class="flex items-center justify-between">
		<span class="text-sm font-semibold">{title}</span>
		<Button size="sm" variant="ghost" aria-label="Remove chart" title="Remove chart" disabled={!removable} onclick={onremove}>
			Remove
		</Button>
	</div>
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
		<div class="space-y-3">{@render controls()}</div>
		<div class="md:col-span-3 rounded-md border border-brand-divider bg-brand-bg p-4 min-h-[400px]">
			{@render chart()}
		</div>
	</div>
	{#if footer}{@render footer()}{/if}
</div>
