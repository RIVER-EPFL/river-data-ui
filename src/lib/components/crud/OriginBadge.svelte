<script lang="ts">
	import Badge from '$components/ui/Badge.svelte';
	import { originLabel } from '$lib/origin';

	// A row entered by hand needs no decision, so it carries no badge.
	let {
		sourceSystem = null,
		discoveredAt = null,
	}: {
		sourceSystem?: string | null;
		discoveredAt?: string | null;
	} = $props();
</script>

{#if sourceSystem}
	<Badge variant="muted">from {originLabel(sourceSystem)}</Badge>
{:else if discoveredAt}
	<Badge variant="muted">from a sync</Badge>
{/if}
