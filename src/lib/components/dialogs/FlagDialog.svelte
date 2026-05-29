<script lang="ts">
	import { PATCH } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		mode,
		siteId,
		parameterId,
		parameterName,
		startMs,
		endMs,
		onsuccess,
	}: {
		open: boolean;
		mode: 'flag' | 'unflag';
		siteId: string;
		parameterId: string;
		parameterName: string;
		startMs: number;
		endMs: number;
		onsuccess?: () => void;
	} = $props();

	let reason = $state('');
	let saving = $state(false);

	$effect(() => {
		if (open) reason = '';
	});

	const startLabel = $derived(new Date(startMs).toLocaleString());
	const endLabel = $derived(new Date(endMs).toLocaleString());
	const title = $derived(mode === 'flag' ? `Flag readings: ${parameterName}` : `Unflag readings: ${parameterName}`);
	const verb = $derived(mode === 'flag' ? 'Flag' : 'Unflag');

	async function handleSave() {
		if (mode === 'flag' && !reason.trim()) {
			toastStore.error('Reason is required to flag readings');
			return;
		}
		saving = true;
		try {
			const body: Record<string, unknown> = {
				site_id: siteId,
				parameter_id: parameterId,
				start_time: new Date(startMs).toISOString(),
				end_time: new Date(endMs).toISOString(),
			};
			if (mode === 'flag') body.reason = reason.trim();
			const res = await PATCH<{ updated: number }>(`/api/readings/${mode}_range`, body);
			if (res.updated === 0) {
				toastStore.info(mode === 'flag' ? 'No readings in range to flag' : 'No flagged readings in range');
			} else {
				toastStore.success(`${verb}ged ${res.updated} reading${res.updated === 1 ? '' : 's'}`);
			}
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : `Failed to ${mode} readings`);
		} finally { saving = false; }
	}
</script>

<Dialog bind:open {title} maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="text-xs text-brand-muted font-mono">
				{startLabel} → {endLabel}
			</div>
			<p class="text-sm text-brand-text">
				{#if mode === 'flag'}
					All raw readings for <span class="font-semibold">{parameterName}</span> in this range will be marked as outliers.
				{:else}
					All flagged readings for <span class="font-semibold">{parameterName}</span> in this range will be restored.
				{/if}
			</p>
			{#if mode === 'flag'}
				<div>
					<label for="flag-reason" class="text-sm font-medium block mb-1">Reason</label>
					<input
						id="flag-reason"
						type="text"
						bind:value={reason}
						placeholder="e.g. sensor out of water, calibration drift, sensor failure"
						class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					/>
					<p class="text-xs text-brand-muted mt-1">Flagged readings are excluded from continuous aggregates but preserved in raw exports.</p>
				</div>
			{:else}
				<p class="text-xs text-brand-muted">Only previously-flagged readings will be affected. Aggregates refresh automatically.</p>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={() => open = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button
			onclick={handleSave}
			disabled={saving || (mode === 'flag' && !reason.trim())}
			class="px-3 py-1.5 rounded-md text-sm cursor-pointer border-none text-white disabled:opacity-50 {mode === 'flag' ? 'bg-severity-alarm' : 'bg-brand-primary'}"
		>{saving ? `${verb}ging...` : verb}</button>
	{/snippet}
</Dialog>
