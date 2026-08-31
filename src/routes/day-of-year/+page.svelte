<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// The seasonal day-of-year overlay now lives on the Explore page.
	onMount(() => {
		goto(`${base}/explore?tab=doy`, { replaceState: true });
	});
</script>

<svelte:head><title>Day of Year | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
