<script lang="ts">
	import { base } from '$app/paths';
	import type { SlotCalculation } from '$lib/calculations/siteSlots';

	let { calculation }: { calculation: SlotCalculation } = $props();

	const title = $derived(
		calculation.writes
			? `Published here by ${calculation.label}`
			: `Read by ${calculation.label}`,
	);
	const tone = $derived(
		calculation.writes
			? 'bg-brand-accent/10 text-brand-accent-dark'
			: 'bg-brand-bg text-brand-muted',
	);
</script>

{#if calculation.id}
	<a
		href="{base}/calculations/{calculation.id}"
		{title}
		class="inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded-full no-underline hover:underline {tone}"
	>{calculation.label}</a>
{:else}
	<span
		{title}
		class="inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded-full {tone}"
	>{calculation.label}</span>
{/if}
