<script lang="ts">
	import { api, type SiteParameter } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';

	// Clears `needs_review` on a site parameter that a verified tool save minted. Sits beside the
	// flag wherever the slot is shown, mirroring ConfirmParameterButton for the catalog entry.
	let {
		siteParameter,
		label,
		size = 'sm',
		onconfirmed,
	}: {
		siteParameter: SiteParameter;
		label: string;
		size?: 'sm' | 'md';
		onconfirmed?: (updated: SiteParameter) => void;
	} = $props();

	let busy = $state(false);

	const canConfirm = $derived(me.can('writeCatalog'));

	async function confirm() {
		busy = true;
		try {
			const updated = await api.siteParameters.update(siteParameter.id, { needs_review: false });
			toastStore.success(`Confirmed ${label} at this site`);
			onconfirmed?.(updated);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to confirm the parameter');
		} finally {
			busy = false;
		}
	}
</script>

{#if siteParameter.needs_review && canConfirm}
	<Button
		variant="ghost"
		{size}
		class="text-brand-primary"
		loading={busy}
		disabled={busy}
		onclick={confirm}
		title="Clear the needs-review flag: this parameter belongs at this site"
	>
		{busy ? 'Confirming…' : 'Confirm'}
	</Button>
{/if}
