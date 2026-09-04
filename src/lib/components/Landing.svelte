<script lang="ts">
	import { base } from '$app/paths';
	import Button from '$components/ui/Button.svelte';
	import { auth } from '$auth/keycloak.svelte';
</script>

<!-- The unauthenticated root. Keycloak's check-sso has found no session, so nothing here may
     call the API: every fetch under /api/ needs a bearer token. -->
<div
	class="relative flex h-screen items-center justify-center bg-brand-primary-dark bg-cover bg-center px-5 text-white"
	style="background-image: url('{base}/landing.jpg')"
>
	<div class="absolute inset-0 bg-brand-primary-dark/60"></div>
	<div class="relative max-w-[520px] text-center">
		<p class="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
			River Ecosystems Laboratory, EPFL
		</p>
		<h1 class="mt-3 text-4xl font-semibold">RIVER Data</h1>
		<p class="mt-4 text-base text-white/85">
			Sensor networks and field measurements from alpine streams in Valais, one platform for the
			NOMIS, METALP, C-NET and BREATHE campaigns.
		</p>
		<p class="mt-3 text-sm text-white/70">
			The data is not publicly available yet. Access is granted to lab members and project
			partners by an administrator.
		</p>
		<Button variant="secondary" onclick={() => auth.login()} class="mt-8 px-8">Sign in</Button>
	</div>
</div>
