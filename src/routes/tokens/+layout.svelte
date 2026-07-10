<script lang="ts">
	import { me } from '$auth/me.svelte';
	import { base } from '$app/paths';

	let { children } = $props();

	// Routing-layer guard for the whole /tokens subtree (list + create). Non-admins never mount the
	// token-management DOM - defense in depth on top of each page's own check. In no-auth dev mode
	// the `me` store resolves to a synthetic admin, so local development is unaffected.
	const ready = $derived(me.status !== 'loading');
	const isAdmin = $derived(me.can('admin'));
</script>

{#if !ready}
	<p class="text-sm text-brand-muted">Loading…</p>
{:else if !isAdmin}
	<div class="space-y-3 max-w-lg">
		<h2 class="text-xl font-semibold">Administrator role required</h2>
		<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			API-token management is restricted to administrators. Ask an administrator to issue a key for
			your client or logger.
		</div>
		<a href="{base}/" class="text-sm text-brand-primary no-underline">&larr; Back to dashboard</a>
	</div>
{:else}
	{@render children()}
{/if}
