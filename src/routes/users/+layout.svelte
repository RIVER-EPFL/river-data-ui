<script lang="ts">
	import { auth } from '$auth/keycloak.svelte';
	import { base } from '$app/paths';

	let { children } = $props();

	// Routing-layer guard for the whole /users subtree. User management is Keycloak-admin only on the
	// API (require_admin), so non-admins never mount this DOM. In no-auth dev mode `auth.role` is
	// 'admin', so local development is unaffected.
	const ready = $derived(auth.state.status !== 'loading');
	const isAdmin = $derived(auth.role === 'admin');
</script>

{#if !ready}
	<p class="text-sm text-brand-muted">Loading…</p>
{:else if !isAdmin}
	<div class="space-y-3 max-w-lg">
		<h2 class="text-xl font-semibold">Administrator role required</h2>
		<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			User management is restricted to administrators.
		</div>
		<a href="{base}/" class="text-sm text-brand-primary no-underline">&larr; Back to dashboard</a>
	</div>
{:else}
	{@render children()}
{/if}
