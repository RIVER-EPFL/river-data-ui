<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type DerivedParameter } from '$api/crud';
	import { recomputeDerived } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime } from '$lib/utils';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	let items = $state<DerivedParameter[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			const result = await api.derivedParameters.list({ perPage: 100, sort: ['name', 'ASC'] });
			items = result.data;
		} finally { loading = false; }
	});

	async function handleRecompute(id: string) {
		try {
			await recomputeDerived(id);
			toastStore.success('Recomputation triggered');
		} catch { toastStore.error('Recomputation failed'); }
	}
</script>

<svelte:head><title>Derived Parameters | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Derived Parameters</h2>
		<a href="{base}/derived/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create</a>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead><tr class="bg-brand-bg border-b border-brand-divider">
				<th class="text-left px-4 py-2 font-semibold">Name</th>
				<th class="text-left px-4 py-2 font-semibold">Formula</th>
				<th class="text-left px-4 py-2 font-semibold">Description</th>
				<th class="text-left px-4 py-2 font-semibold">Created</th>
				<th class="text-left px-4 py-2 font-semibold">Actions</th>
			</tr></thead>
			<tbody>
				{#if loading}
					<tr><td colspan="5" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if items.length === 0}
					<tr><td colspan="5" class="px-4 py-8 text-center text-brand-muted">No derived parameters</td></tr>
				{:else}
					{#each items as item}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2"><a href="{base}/derived/{item.id}" class="text-brand-primary font-semibold no-underline hover:underline">{item.name}</a></td>
							<td class="px-4 py-2 font-mono text-xs text-brand-muted max-w-[300px] truncate">{item.formula}</td>
							<td class="px-4 py-2 text-brand-muted">{item.description ?? '—'}</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{formatRelativeTime(item.created_at)}</td>
							<td class="px-4 py-2">
								<ConfirmPopover message="Recompute all readings for this derived parameter?" confirmLabel="Recompute" confirmVariant="primary" onconfirm={() => handleRecompute(item.id)}>
									<button class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">Recompute</button>
								</ConfirmPopover>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>
