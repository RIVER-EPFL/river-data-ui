<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { logsRedirectTarget } from '$lib/logsRedirect';

	onMount(() => {
		goto(`${base}${logsRedirectTarget(page.url.searchParams)}`, { replaceState: true });
	});
</script>

<svelte:head><title>System | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
