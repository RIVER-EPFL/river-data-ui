<script lang="ts">
	import { api } from '$api/crud';
	import { recalibrateCalibration } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		sensorId,
		sensorName,
		onsuccess,
	}: {
		open: boolean;
		sensorId: string;
		sensorName: string;
		onsuccess?: () => void;
	} = $props();

	let slope = $state('1.0');
	let intercept = $state('0.0');
	let validFrom = $state(new Date().toISOString().slice(0, 16));
	let notes = $state('');
	let saving = $state(false);

	async function handleSave() {
		saving = true;
		try {
			const cal = await api.sensorCalibrations.create({
				sensor_id: sensorId,
				slope: Number(slope),
				intercept: Number(intercept),
				valid_from: new Date(validFrom).toISOString(),
				notes: notes || undefined,
			});
			await recalibrateCalibration((cal as { id: string }).id);
			toastStore.success('Calibration saved and recalculation triggered');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Calibration failed');
		} finally { saving = false; }
	}
</script>

<Dialog bind:open title="Calibrate {sensorName}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="slope" class="text-sm font-medium">Slope</label>
					<input id="slope" type="number" step="any" bind:value={slope} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
				<div class="flex flex-col gap-1">
					<label for="intercept" class="text-sm font-medium">Intercept</label>
					<input id="intercept" type="number" step="any" bind:value={intercept} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<label for="valid" class="text-sm font-medium">Valid From</label>
				<input id="valid" type="datetime-local" bind:value={validFrom} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>
			<div class="text-xs text-brand-muted font-mono">y = {slope}x + {intercept}</div>
			<div class="flex flex-col gap-1">
				<label for="notes" class="text-sm font-medium">Notes</label>
				<textarea id="notes" bind:value={notes} rows="2" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"></textarea>
			</div>
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={() => open = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button onclick={handleSave} disabled={saving} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{saving ? 'Saving...' : 'Save & Recalculate'}</button>
	{/snippet}
</Dialog>
