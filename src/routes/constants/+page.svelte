<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// Constants now live in a tab beside the parameter catalog.
	onMount(() => {
		goto(`${base}/parameters?tab=constants`, { replaceState: true });
	});
</script>

<svelte:head><title>Constants | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
