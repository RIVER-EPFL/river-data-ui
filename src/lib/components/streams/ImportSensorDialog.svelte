<script lang="ts">
	import type { DataStream } from '$api/crud';
	import { importStream } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	// Import registers the stream's device into the inventory and nothing else: no site, no
	// deployment, no parameter. The sensor's parameter is bound when it is deployed or when a grab
	// names it, so this dialog asks for nothing and the request carries nothing.

	let {
		open = $bindable(false),
		stream,
		onimported,
	}: {
		open?: boolean;
		stream: DataStream | null;
		onimported?: () => void;
	} = $props();

	let importing = $state(false);

	async function handleImport() {
		if (!stream) return;
		importing = true;
		try {
			const res = await importStream(stream.id);
			toastStore.success(
				`Sensor imported · ${res.attributed} reading${res.attributed === 1 ? '' : 's'} attributed`
			);
			open = false;
			onimported?.();
		} catch (e) {
			toastStore.error(`Import failed: ${e instanceof Error ? e.message : e}`);
		} finally {
			importing = false;
		}
	}
</script>

<Dialog bind:open title="Import Sensor" maxWidth="sm">
	{#snippet children()}
		{#if stream}
			<div class="space-y-3">
				<div class="text-sm"><span class="text-brand-muted">Stream:</span> <span class="font-mono">{stream.source_key}</span></div>
				<p class="text-xs text-brand-muted">Registers this stream's device into the sensor inventory (creates the sensor and stamps its existing readings) without assigning it to a site. No calibration is created - the readings resolve whatever curves the sensor already has. The sensor carries no parameter of its own: one is bound when it is deployed or when a grab names it. Pair the stream separately to attribute its data to a site.</p>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" onclick={handleImport} disabled={importing}>{importing ? 'Importing…' : 'Import'}</Button>
	{/snippet}
</Dialog>
