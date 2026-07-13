<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	// Instruments now live in the unified Sensors & Instruments list, filtered by type.
	onMount(() => {
		const type = page.url.searchParams.get('type');
		const query = type ? `?type=${type}` : '';
		goto(`${base}/sensors${query}`, { replaceState: true });
	});
</script>

<svelte:head><title>Instruments | River Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
