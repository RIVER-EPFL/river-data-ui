<script lang="ts">
	import { decommissionToolScript, getCalculationSites, recommissionToolScript } from '$api/service';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { decommissionConsequence, recommissionOutcome } from '$lib/toolbox/decommission';
	import Button from '$components/ui/Button.svelte';

	// Decommissioning and recommissioning each ask why, and a decommission says where it stops,
	// before it is done (Q272, Q279).
	let {
		id,
		decommissioned = false,
		onchanged,
	}: {
		id: string;
		decommissioned?: boolean;
		onchanged?: () => void | Promise<void>;
	} = $props();

	let asking = $state(false);
	let reason = $state('');
	let sites = $state<number | null>(null);
	let saving = $state(false);
	const verb = $derived(decommissioned ? 'Recommission' : 'Decommission');

	async function open() {
		asking = true;
		reason = '';
		sites = null;
		if (decommissioned) return;
		try {
			sites = (await getCalculationSites()).find((c) => c.calculation_id === id)?.sites.length ?? 0;
		} catch {
			sites = null;
		}
	}

	async function confirm() {
		saving = true;
		try {
			if (decommissioned) {
				const done = await recommissionToolScript(id, reason.trim());
				toastStore.success(recommissionOutcome(done.calculation.name, done.name_restored));
			} else {
				await decommissionToolScript(id, reason.trim());
				toastStore.success('Calculation decommissioned');
			}
			asking = false;
			await onchanged?.();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			saving = false;
		}
	}
</script>

{#if !asking}
	<Button size="sm" variant="ghost" onclick={open}>{verb}</Button>
{:else}
	<div role="alertdialog" aria-label="{verb} calculation" class="flex flex-col gap-2 text-xs">
		<p class="text-brand-muted">
			{decommissioned
				? 'It comes back switched off, under its former name unless another calculation has taken it.'
				: decommissionConsequence(sites)}
		</p>
		<label class="flex flex-col gap-1">
			<span class="font-medium">Reason</span>
			<input
				type="text"
				bind:value={reason}
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</label>
		<div class="flex flex-wrap gap-2">
			<Button
				size="sm"
				variant={decommissioned ? 'primary' : 'danger'}
				onclick={confirm}
				disabled={saving || !reason.trim()}
				>{saving ? `${verb}ing…` : verb}</Button
			>
			<Button size="sm" variant="ghost" onclick={() => (asking = false)}>Keep</Button>
		</div>
	</div>
{/if}
