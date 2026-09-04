<script lang="ts">
	import { PATCH } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
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
	let count = $state<number | null>(null);

	function rangeBody(): Record<string, unknown> {
		return {
			site_id: siteId,
			parameter_id: parameterId,
			start_time: new Date(startMs).toISOString(),
			end_time: new Date(endMs).toISOString(),
		};
	}

	// The count the write will report, from the same endpoint with dry_run, so the dialog and
	// the toast cannot disagree.
	async function loadCount() {
		count = null;
		try {
			const res = await PATCH<{ updated: number }>(`/api/readings/${mode}_range`, { ...rangeBody(), dry_run: true });
			count = res.updated;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to count readings in range');
		}
	}

	$effect(() => {
		if (open) {
			reason = '';
			void loadCount();
		}
	});

	const startLabel = $derived(formatDateTime(new Date(startMs)));
	const endLabel = $derived(formatDateTime(new Date(endMs)));
	const title = $derived(mode === 'flag' ? `Flag readings: ${parameterName}` : `Unflag readings: ${parameterName}`);
	const verb = $derived(mode === 'flag' ? 'Flag' : 'Unflag');

	async function handleSave() {
		if (mode === 'flag' && !reason.trim()) {
			toastStore.error('Reason is required to flag readings');
			return;
		}
		saving = true;
		try {
			const body = rangeBody();
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
			<p class="text-sm text-brand-text" data-testid="flag-count">
				<span class="font-mono font-semibold">{count ?? '…'}</span>
				{mode === 'flag' ? 'reading' : 'flagged reading'}{count === 1 ? '' : 's'}, {startLabel} to {endLabel}
			</p>
			<p class="text-xs text-brand-muted">
				{#if mode === 'flag'}
					Flagged readings leave the continuous aggregates and stay in raw exports.
				{:else}
					Unflagged readings return to the continuous aggregates.
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
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => open = false}>Cancel</Button>
		<button
			onclick={handleSave}
			disabled={saving || count === 0 || (mode === 'flag' && !reason.trim())}
			class="px-3 py-1.5 rounded-md text-sm cursor-pointer border-none text-white disabled:opacity-50 {mode === 'flag' ? 'bg-severity-alarm' : 'bg-brand-primary'}"
		>{saving ? `${verb}ging…` : verb}</button>
	{/snippet}
</Dialog>
