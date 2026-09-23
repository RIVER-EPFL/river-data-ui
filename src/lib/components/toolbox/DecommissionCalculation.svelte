<script lang="ts">
	import { decommissionToolScript, getCalculationSites } from '$api/service';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { decommissionConsequence } from '$lib/toolbox/decommission';
	import Button from '$components/ui/Button.svelte';

	// Decommissioning is for good (Q272), so it asks why and says where it stops before it is done.
	let {
		id,
		ondecommissioned,
	}: {
		id: string;
		ondecommissioned?: () => void | Promise<void>;
	} = $props();

	let asking = $state(false);
	let reason = $state('');
	let sites = $state<number | null>(null);
	let saving = $state(false);

	async function open() {
		asking = true;
		reason = '';
		sites = null;
		try {
			sites = (await getCalculationSites()).find((c) => c.calculation_id === id)?.sites.length ?? 0;
		} catch {
			sites = null;
		}
	}

	async function confirm() {
		saving = true;
		try {
			await decommissionToolScript(id, reason.trim());
			toastStore.success('Calculation decommissioned');
			asking = false;
			await ondecommissioned?.();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			saving = false;
		}
	}
</script>

{#if !asking}
	<Button size="sm" variant="ghost" onclick={open}>Decommission</Button>
{:else}
	<div role="alertdialog" aria-label="Decommission calculation" class="flex flex-col gap-2 text-xs">
		<p class="text-brand-muted">{decommissionConsequence(sites)}</p>
		<label class="flex flex-col gap-1">
			<span class="font-medium">Reason</span>
			<input
				type="text"
				bind:value={reason}
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</label>
		<div class="flex flex-wrap gap-2">
			<Button size="sm" variant="danger" onclick={confirm} disabled={saving || !reason.trim()}
				>{saving ? 'Decommissioning…' : 'Decommission'}</Button
			>
			<Button size="sm" variant="ghost" onclick={() => (asking = false)}>Keep</Button>
		</div>
	</div>
{/if}
