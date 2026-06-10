<script lang="ts">
	import { mergeSiteParameters } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	// Merges one site_parameter into another within the same site: readings,
	// status events, streams, and deployments are reassigned to the target and
	// the source is deleted. Candidates are the site's other parameters.
	let {
		open = $bindable(false),
		source,
		candidates,
		onsuccess,
	}: {
		open: boolean;
		source: { id: string; label: string };
		candidates: { id: string; label: string }[];
		onsuccess?: () => void;
	} = $props();

	let targetId = $state('');
	let merging = $state(false);

	const options = $derived(candidates.filter((c) => c.id !== source.id));
	const target = $derived(options.find((c) => c.id === targetId));

	$effect(() => {
		if (!open) targetId = '';
	});

	async function doMerge() {
		if (!targetId) return;
		merging = true;
		try {
			const r = await mergeSiteParameters(source.id, targetId);
			const parts = [];
			if (r.merged_readings > 0) parts.push(`${r.merged_readings} readings`);
			if (r.merged_status_events > 0) parts.push(`${r.merged_status_events} status events`);
			if (r.streams_updated > 0) parts.push(`${r.streams_updated} streams`);
			if (r.deployments_moved > 0) parts.push(`${r.deployments_moved} deployments`);
			toastStore.success(`Merged ${source.label} into ${target?.label ?? 'target'}. ${parts.join(', ')}.`);
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Merge failed');
		} finally {
			merging = false;
		}
	}
</script>

<Dialog bind:open title="Merge site parameter" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-4">
			<p class="text-sm">
				Merge <strong>{source.label}</strong> into another parameter at this site. All readings,
				status events, streams, and deployments are reassigned to the target. The source is deleted.
			</p>
			<label class="block">
				<span class="text-sm font-medium">Target parameter</span>
				<select bind:value={targetId} class="mt-1 block w-full rounded-md border border-brand-divider bg-brand-bg px-3 py-2 text-sm">
					<option value="">Select target…</option>
					{#each options as c}
						<option value={c.id}>{c.label}</option>
					{/each}
				</select>
			</label>
			{#if target}
				<div class="rounded-md bg-severity-alarm/10 border border-severity-alarm/30 p-3 text-sm">
					<p class="font-medium text-severity-alarm">This cannot be undone.</p>
					<p class="mt-1 text-brand-muted"><strong>{source.label}</strong> will be absorbed into <strong>{target.label}</strong>.</p>
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<div class="flex justify-end gap-2">
			<Button class="bg-transparent" onclick={() => (open = false)}>Cancel</Button>
			{#if target}
				<ConfirmPopover message="All data will be moved to {target.label}. This is irreversible." confirmLabel="Merge" confirmVariant="alarm" onconfirm={doMerge}>
					<Button variant="danger" disabled={merging}>{merging ? 'Merging…' : 'Merge'}</Button>
				</ConfirmPopover>
			{/if}
		</div>
	{/snippet}
</Dialog>
