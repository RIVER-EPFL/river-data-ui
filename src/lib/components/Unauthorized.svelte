<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { auth } from '$lib/auth/keycloak.svelte';
</script>

<!-- Full-shell takeover for authenticated users without a riverdata role: the EPFL-federated
     realm lets anyone log in, but membership is granted by an administrator. Rendered as a
     layout branch so no route is reachable underneath it. -->
<div class="flex h-screen items-center justify-center flex-col text-center px-5">
	<p class="text-lg font-semibold text-brand-text">No access to RIVER Data</p>
	{#if auth.identity}
		<p class="text-sm mt-2 text-brand-muted">
			You are signed in as <span class="font-medium">{auth.identity.fullName}</span>, but this
			account has not been granted access.
		</p>
	{/if}
	<p class="text-sm mt-1 text-brand-muted max-w-[420px]">
		Contact an administrator to request access to the platform.
	</p>
	<Button variant="secondary" onclick={() => auth.logout()} class="mt-5">Sign out</Button>
</div>
