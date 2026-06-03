<script lang="ts">
	import { api, type AlarmThreshold } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		siteId,
		parameterId,
		parameterName,
		existing,
		onsuccess,
	}: {
		open: boolean;
		siteId: string;
		parameterId: string;
		parameterName: string;
		existing?: AlarmThreshold | null;
		onsuccess?: () => void;
	} = $props();

	let warningMin = $state(existing?.warning_min?.toString() ?? '');
	let warningMax = $state(existing?.warning_max?.toString() ?? '');
	let alarmMin = $state(existing?.alarm_min?.toString() ?? '');
	let alarmMax = $state(existing?.alarm_max?.toString() ?? '');
	let saving = $state(false);

	$effect(() => {
		if (existing) {
			warningMin = existing.warning_min?.toString() ?? '';
			warningMax = existing.warning_max?.toString() ?? '';
			alarmMin = existing.alarm_min?.toString() ?? '';
			alarmMax = existing.alarm_max?.toString() ?? '';
		}
	});

	function num(s: string): number | null { return s === '' ? null : Number(s); }

	async function handleSave() {
		saving = true;
		try {
			const payload = {
				site_id: siteId,
				parameter_id: parameterId,
				warning_min: num(warningMin),
				warning_max: num(warningMax),
				alarm_min: num(alarmMin),
				alarm_max: num(alarmMax),
			};
			if (existing) {
				await api.alarmThresholds.update(existing.id, payload);
			} else {
				await api.alarmThresholds.create(payload);
			}
			toastStore.success('Thresholds saved');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Save failed');
		} finally { saving = false; }
	}
</script>

<Dialog bind:open title="Thresholds: {parameterName}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-4">
			<div>
				<div class="text-sm font-medium text-severity-warning mb-2">Warning</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label for="wmin" class="text-xs text-brand-muted">Min</label>
						<input id="wmin" type="number" step="any" bind:value={warningMin} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div class="flex flex-col gap-1">
						<label for="wmax" class="text-xs text-brand-muted">Max</label>
						<input id="wmax" type="number" step="any" bind:value={warningMax} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
			</div>
			<div>
				<div class="text-sm font-medium text-severity-alarm mb-2">Alarm</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label for="amin" class="text-xs text-brand-muted">Min</label>
						<input id="amin" type="number" step="any" bind:value={alarmMin} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div class="flex flex-col gap-1">
						<label for="amax" class="text-xs text-brand-muted">Max</label>
						<input id="amax" type="number" step="any" bind:value={alarmMax} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
			</div>
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={() => open = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button onclick={handleSave} disabled={saving} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
	{/snippet}
</Dialog>
