<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// Derived parameters are integrated into the Parameters catalog (filter: Derived only).
	onMount(() => {
		goto(`${base}/parameters?type=derived`, { replaceState: true });
	});
</script>

<svelte:head><title>Derived Parameters | River Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
