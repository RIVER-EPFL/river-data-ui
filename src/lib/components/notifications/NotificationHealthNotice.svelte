<script lang="ts">
	import { base } from '$app/paths';
	import { getNotificationsHealth, type NotificationHealth } from '$api/service';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// The endpoint is administrator-only, so a viewer who cannot read it is not asked to.
	let { enabled = true }: { enabled?: boolean } = $props();

	let health = $state<NotificationHealth | null>(null);

	// A notice about the alerting being down must not take the page it sits on with it, and a
	// notice nobody can read is not worth a failed request either.
	$effect(() => {
		if (!enabled) return;
		getNotificationsHealth()
			.then((h) => (health = h))
			.catch(() => (health = null));
	});

	const unhealthy = $derived(
		health?.channels.filter((c) => c.available && c.healthy === false) ?? []
	);
	const unreached = $derived((health?.undeliverable24h ?? 0) + (health?.failed24h ?? 0));
</script>

{#snippet link()}
	<a href="{base}/notifications" class="text-brand-primary no-underline hover:underline"
		>Notifications</a
	>
{/snippet}

{#if health?.noChannelConfigured}
	<ErrorNotice>
		No notification channel is configured, so every alarm is recorded as undeliverable and nobody is
		told. Ingestion is unaffected. {@render link()}
	</ErrorNotice>
{:else if unhealthy.length > 0}
	<ErrorNotice>
		{unhealthy.map((c) => (c.detail ? `${c.name} (${c.detail})` : c.name)).join(', ')} failed its last
		health check, so alarms may reach nobody. {@render link()}
	</ErrorNotice>
{:else if unreached > 0}
	<ErrorNotice>
		{unreached} notification{unreached === 1 ? '' : 's'} reached nobody in the last 24 hours.
		{@render link()}
	</ErrorNotice>
{/if}
