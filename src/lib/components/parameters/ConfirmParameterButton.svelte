<script lang="ts">
	import { api, type Parameter } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';

	// Clears `needs_review` on a catalog entry that was created mechanically (the analyte seed,
	// stream discovery). Confirming is the only way the flag ever comes off outside a merge, so the
	// action sits wherever the flag is shown rather than inside the edit form.
	let {
		parameter,
		size = 'sm',
		onconfirmed,
	}: {
		parameter: Parameter;
		size?: 'sm' | 'md';
		onconfirmed?: (updated: Parameter) => void;
	} = $props();

	let busy = $state(false);

	const canConfirm = $derived(me.can('writeCatalog'));

	async function confirm() {
		busy = true;
		try {
			const updated = await api.parameters.update(parameter.id, { needs_review: false });
			toastStore.success(`Confirmed ${updated.name}`);
			onconfirmed?.(updated);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to confirm the parameter');
		} finally {
			busy = false;
		}
	}
</script>

{#if parameter.needs_review && canConfirm}
	<Button
		{size}
		loading={busy}
		disabled={busy}
		onclick={confirm}
		title="Clear the needs-review flag: this entry is a real catalog parameter"
	>
		{busy ? 'Confirming…' : 'Confirm'}
	</Button>
{/if}
