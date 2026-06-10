<script lang="ts">
	import { api, type Parameter } from '$api/crud';
	import { mergeParameters } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	let {
		open = $bindable(false),
		sourceParameter,
		onsuccess,
	}: {
		open: boolean;
		sourceParameter: { id: string; code: string; name: string; default_units: string };
		onsuccess?: (targetId: string) => void;
	} = $props();

	let allParams = $state<Parameter[]>([]);
	let targetId = $state('');
	let merging = $state(false);
	let loading = $state(false);

	const candidates = $derived(
		allParams.filter((p) => p.id !== sourceParameter.id)
	);

	const target = $derived(candidates.find((p) => p.id === targetId));

	$effect(() => {
		if (open && allParams.length === 0) {
			loading = true;
			api.parameters.list({ perPage: 500 }).then((res) => {
				allParams = res.data;
				loading = false;
			});
		}
		if (!open) {
			targetId = '';
		}
	});

	async function doMerge() {
		merging = true;
		try {
			const result = await mergeParameters(sourceParameter.id, targetId);
			const parts = [];
			if (result.readings_moved > 0) parts.push(`${result.readings_moved} readings moved`);
			if (result.sites_merged > 0) parts.push(`${result.sites_merged} sites merged`);
			if (result.sites_reassigned > 0) parts.push(`${result.sites_reassigned} sites reassigned`);
			if (result.streams_updated > 0) parts.push(`${result.streams_updated} streams updated`);
			toastStore.success(`Merged ${sourceParameter.name} into ${target?.name ?? 'target'}. ${parts.join(', ')}.`);
			open = false;
			onsuccess?.(targetId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Merge failed');
		} finally {
			merging = false;
		}
	}
</script>

<Dialog bind:open title="Merge Parameter" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-4">
			<p class="text-sm">
				Merge <strong>{sourceParameter.name}{sourceParameter.default_units ? ` (${sourceParameter.default_units})` : ''}</strong> into another parameter.
				All readings, streams, site assignments, and references will be reassigned to the target. The source parameter will be deleted.
			</p>

			{#if loading}
				<p class="text-sm text-brand-muted">Loading parameters…</p>
			{:else}
				<label class="block">
					<span class="text-sm font-medium">Target parameter</span>
					<select bind:value={targetId} class="mt-1 block w-full rounded-md border border-brand-divider bg-brand-bg px-3 py-2 text-sm">
						<option value="">Select target…</option>
						{#each candidates as p}
							<option value={p.id}>{p.name}{p.default_units ? ` (${p.default_units})` : ''}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if target}
				<div class="rounded-md bg-severity-alarm/10 border border-severity-alarm/30 p-3 text-sm">
					<p class="font-medium text-severity-alarm">This cannot be undone.</p>
					<p class="mt-1 text-brand-muted">
						<strong>{sourceParameter.name}</strong> will be absorbed into <strong>{target.name}</strong>.
						The source code will be added as an alias on the target.
					</p>
				</div>
			{/if}
		</div>
	{/snippet}

	{#snippet actions()}
		<div class="flex justify-end gap-2">
			<Button class="bg-transparent" onclick={() => open = false}>
				Cancel
			</Button>
			{#if target}
				<ConfirmPopover
					message="All data will be moved to {target.name}. This is irreversible."
					confirmLabel="Merge"
					confirmVariant="alarm"
					onconfirm={doMerge}
				>
					<Button variant="danger" disabled={merging}>
						{merging ? 'Merging…' : 'Merge'}
					</Button>
				</ConfirmPopover>
			{/if}
		</div>
	{/snippet}
</Dialog>
