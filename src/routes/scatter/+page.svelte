<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// Cross-parameter scatter now lives on the Explore page.
	onMount(() => {
		goto(`${base}/explore?tab=scatter`, { replaceState: true });
	});
</script>

<svelte:head><title>Scatter | River Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
