<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	// API tokens now live in a tab beside Users. Preserve the ?show=<id> deep link.
	onMount(() => {
		const show = page.url.searchParams.get('show');
		const query = show ? `&show=${show}` : '';
		goto(`${base}/users?tab=tokens${query}`, { replaceState: true });
	});
</script>

<svelte:head><title>API Tokens | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
