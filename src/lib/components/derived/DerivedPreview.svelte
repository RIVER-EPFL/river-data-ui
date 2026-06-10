<script lang="ts">
	import { previewDerived, type PreviewDerivedResponse } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';

	let {
		formula,
		sites = [],
	}: {
		formula: string;
		sites: Array<{ id: string; name: string }>;
	} = $props();

	let selectedSiteId = $state('');
	let start = $state(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 16));
	let end = $state(new Date().toISOString().slice(0, 16));
	let loading = $state(false);
	let result = $state<PreviewDerivedResponse | null>(null);

	async function runPreview() {
		if (!selectedSiteId || !formula) return;
		loading = true;
		result = null;
		try {
			result = await previewDerived({
				formula,
				site_id: selectedSiteId,
				start: new Date(start).toISOString(),
				end: new Date(end).toISOString(),
			});
		} catch (e) {
			toastStore.error(`Preview failed: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			loading = false;
		}
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider">
		<span class="text-sm font-semibold">Preview</span>
	</div>
	<div class="p-4 space-y-3">
		<div class="flex flex-wrap items-end gap-3">
			<div>
				<label for="preview-site" class="text-xs text-brand-muted block mb-1">Site</label>
				<select id="preview-site" bind:value={selectedSiteId} class="px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface">
					<option value="">Select site…</option>
					{#each sites as s}
						<option value={s.id}>{s.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="preview-start" class="text-xs text-brand-muted block mb-1">Start</label>
				<input id="preview-start" type="datetime-local" bind:value={start} class="px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
			<div>
				<label for="preview-end" class="text-xs text-brand-muted block mb-1">End</label>
				<input id="preview-end" type="datetime-local" bind:value={end} class="px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
			</div>
			<Button
				variant="primary"
				onclick={runPreview}
				disabled={loading || !selectedSiteId || !formula}
			>
				{loading ? 'Loading…' : 'Preview'}
			</Button>
		</div>

		{#if result}
			{@const maxRows = 20}
			{@const times = result.times}
			{@const truncated = times.length > maxRows}
			<div class="overflow-x-auto">
				<table class="w-full text-xs font-mono">
					<thead>
						<tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-3 py-1.5 font-semibold">Time</th>
							{#each result.source_parameters as sp}
								<th class="text-right px-3 py-1.5 font-semibold text-brand-muted">{sp.name} ({sp.units})</th>
							{/each}
							<th class="text-right px-3 py-1.5 font-semibold text-brand-primary">Result</th>
						</tr>
					</thead>
					<tbody>
						{#each times.slice(0, maxRows) as time, i}
							{@const hasError = result.derived.errors[i] != null}
							<tr class="border-b border-brand-divider last:border-b-0" class:bg-severity-alarm-soft={hasError}>
								<td class="px-3 py-1">{time}</td>
								{#each result.source_parameters as sp}
									<td class="text-right px-3 py-1">{sp.values[i] != null ? sp.values[i]?.toFixed(4) : '---'}</td>
								{/each}
								<td class="text-right px-3 py-1 font-semibold" class:text-severity-alarm={hasError}>
									{#if hasError}
										{result.derived.errors[i]}
									{:else}
										{result.derived.values[i] != null ? result.derived.values[i]?.toFixed(4) : '---'}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if truncated}
					<p class="text-xs text-brand-muted px-3 py-2">Showing {maxRows} of {times.length} rows</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
