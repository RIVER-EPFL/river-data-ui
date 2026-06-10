<script lang="ts">
	import { POST } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		siteId,
		parameterId,
		parameterName,
		startMs,
		endMs,
		onsuccess,
	}: {
		open: boolean;
		siteId: string;
		parameterId: string;
		parameterName: string;
		startMs: number;
		endMs: number;
		onsuccess?: () => void;
	} = $props();

	let text = $state('');
	let category = $state<'maintenance' | 'quality_issue' | 'environmental' | 'other'>('other');
	let saving = $state(false);

	$effect(() => {
		if (open) {
			text = '';
			category = 'other';
		}
	});

	const startIso = $derived(new Date(startMs).toISOString());
	const endIso = $derived(new Date(endMs).toISOString());
	const startLabel = $derived(formatDateTime(new Date(startMs)));
	const endLabel = $derived(formatDateTime(new Date(endMs)));

	async function handleSave() {
		if (!text.trim()) {
			toastStore.error('Annotation text is required');
			return;
		}
		saving = true;
		try {
			await POST('/api/annotations', {
				site_id: siteId,
				parameter_id: parameterId,
				start_time: startIso,
				end_time: endIso,
				text: text.trim(),
				category,
			});
			toastStore.success('Annotation saved');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to save annotation');
		} finally { saving = false; }
	}
</script>

<Dialog bind:open title="Annotate: {parameterName}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="text-xs text-brand-muted font-mono">
				{startLabel} → {endLabel}
			</div>
			<div>
				<label for="ann-category" class="text-sm font-medium block mb-1">Category</label>
				<select id="ann-category" bind:value={category} class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="maintenance">Maintenance</option>
					<option value="quality_issue">Quality issue</option>
					<option value="environmental">Environmental event</option>
					<option value="other">Other</option>
				</select>
			</div>
			<div>
				<label for="ann-text" class="text-sm font-medium block mb-1">Description</label>
				<textarea
					id="ann-text"
					bind:value={text}
					rows="4"
					placeholder="e.g. sensor was out of water, calibration drift, field maintenance…"
					class="w-full px-3 py-2 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
				></textarea>
			</div>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => open = false}>Cancel</Button>
		<Button variant="primary" onclick={handleSave} disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
	{/snippet}
</Dialog>
