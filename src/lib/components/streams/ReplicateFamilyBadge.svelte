<script lang="ts">
	import type { ReplicateSpec } from '$api/service';

	// Compact chip marking a replicate-family stream. Clicking toggles an inline expansion listing
	// the member columns in replicate order plus the portal columns audited (not stored) at sync.
	let { spec }: { spec: ReplicateSpec } = $props();

	let expanded = $state(false);

	const auditedColumns = $derived(
		[spec.portal_mean_column, spec.portal_sd_column].filter((c): c is string => !!c),
	);
</script>

<span class="inline-flex flex-col align-middle">
	<button
		type="button"
		onclick={(e) => { e.stopPropagation(); expanded = !expanded; }}
		title={expanded ? 'Hide replicate columns' : 'Show replicate columns'}
		class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border cursor-pointer bg-brand-primary/10 text-brand-primary border-brand-primary/30 hover:bg-brand-primary/20"
	>
		<span aria-hidden="true">⧉</span>
		{spec.source_columns.length} replicate{spec.source_columns.length === 1 ? '' : 's'}
		{#if spec.curve_ref_column}
			<span class="px-1 rounded bg-brand-bg text-brand-muted text-[10px]">curve</span>
		{/if}
		{#if spec.portal_mean_column}
			<span class="px-1 rounded bg-brand-bg text-brand-muted text-[10px]">avg/sd audited</span>
		{/if}
	</button>

	{#if expanded}
		<span class="mt-1 rounded-md border border-brand-divider bg-brand-bg px-2 py-1.5 text-[11px] text-left space-y-0.5">
			{#each spec.source_columns as col, i}
				<span class="block font-mono">
					<span class="text-brand-muted">{i}:</span> {col}
				</span>
			{/each}
			{#each auditedColumns as col}
				<span class="block font-mono text-brand-muted">{col}: audited at sync, not stored</span>
			{/each}
			{#if spec.curve_ref_column}
				<span class="block font-mono text-brand-muted">{spec.curve_ref_column}: curve reference</span>
			{/if}
			{#if spec.calc}
				<span class="block text-brand-muted">calc: {spec.calc}</span>
			{/if}
		</span>
	{/if}
</span>
