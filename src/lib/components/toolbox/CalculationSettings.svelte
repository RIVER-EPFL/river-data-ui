<script lang="ts">
	import { updateToolScript } from '$api/service';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import CalculationSwitch from '$components/toolbox/CalculationSwitch.svelte';
	import DecommissionCalculation from '$components/toolbox/DecommissionCalculation.svelte';
	import { me } from '$auth/me.svelte';

	let {
		calculation,
		onsaved,
	}: {
		calculation: {
			id: string;
			label: string;
			description?: string | null;
			enabled: boolean;
			decommissioned_at?: string | null;
		};
		onsaved?: () => void | Promise<void>;
	} = $props();

	let label = $state('');
	let description = $state('');
	let saving = $state(false);

	$effect(() => {
		label = calculation.label;
		description = calculation.description ?? '';
	});

	async function save() {
		saving = true;
		try {
			await updateToolScript(calculation.id, {
				label,
				description: description || undefined,
			});
			toastStore.success('Saved');
			await onsaved?.();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-3">
	{#if !calculation.decommissioned_at}
		<CalculationSwitch id={calculation.id} enabled={calculation.enabled} onchanged={() => onsaved?.()} />
	{/if}
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<div class="flex flex-col gap-1">
			<label for="calc-label-{calculation.id}" class="text-sm font-medium">Label</label>
			<input
				id="calc-label-{calculation.id}"
				type="text"
				bind:value={label}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label for="calc-desc-{calculation.id}" class="text-sm font-medium">Description</label>
			<input
				id="calc-desc-{calculation.id}"
				type="text"
				bind:value={description}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</div>
	</div>
	<Button size="sm" onclick={save} disabled={saving || !label.trim()}>{saving ? 'Saving…' : 'Save label'}</Button>
	{#if me.can('admin') && !calculation.decommissioned_at}
		<DecommissionCalculation id={calculation.id} ondecommissioned={() => onsaved?.()} />
	{/if}
</div>
