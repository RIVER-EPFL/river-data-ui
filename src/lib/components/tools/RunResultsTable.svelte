<script lang="ts">
	import type { RunCell, RunRow, RunTables } from '$lib/tools/runTable';

	// A run as the portal reads it: parameters down, replicates across, the steps of the
	// calculation above what it publishes, and the statistics in a table of their own.
	let { tables }: { tables: RunTables } = $props();

	function fmt(value: number | null): string {
		if (value === null) return '--';
		return Number.isInteger(value) ? String(value) : value.toPrecision(6);
	}

	const hasRows = $derived(
		tables.steps.length + tables.outputs.length + tables.statistics.length > 0,
	);

	// The one open cell, keyed by row and column; a second click, or a click on another cell,
	// closes it.
	let open = $state<string | null>(null);
	const cellKey = (row: string, column: number) => `${row}:${column}`;
	function toggle(key: string) {
		open = open === key ? null : key;
	}
</script>

{#snippet equation(cell: RunCell)}
	{#if cell.trace}
		<div
			class="absolute z-40 right-0 top-full mt-1 bg-brand-surface border border-brand-divider rounded-md shadow-lg p-3 min-w-[220px] max-w-sm w-max text-left font-sans font-normal whitespace-normal"
		>
			<p class="font-mono text-xs break-all mb-2">{cell.trace.formula}</p>
			{#if cell.trace.bindings.length > 0}
				<dl class="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
					{#each cell.trace.bindings as b (b.name)}
						<dt class="font-mono">
							{#if b.step}
								<a href="#run-row-{b.step}" class="text-brand-primary hover:underline">{b.name}</a>
							{:else}
								{b.name}
							{/if}
						</dt>
						<dd class="font-mono text-right">{fmt(b.value)}</dd>
					{/each}
				</dl>
			{/if}
			<p class="font-mono text-xs mt-2 pt-2 border-t border-brand-divider">= {fmt(cell.value)}</p>
		</div>
	{/if}
{/snippet}

{#snippet band(title: string | null, rows: RunRow[], muted: boolean)}
	{#if rows.length > 0}
		{#if title}
			<tr>
				<th
					colspan={tables.columns.length + 1}
					class="text-left px-2 py-1 text-[11px] uppercase tracking-wide text-brand-muted bg-brand-bg"
					>{title}</th
				>
			</tr>
		{/if}
		{#each rows as row (row.key)}
			<tr
				id="run-row-{row.key}"
				class="border-b border-brand-divider last:border-b-0 {muted ? 'text-brand-muted' : ''}"
			>
				<td class="px-2 py-1 text-sm">
					{row.label}{#if row.units}&nbsp;<span class="text-xs text-brand-muted">({row.units})</span
						>{/if}
				</td>
				{#each row.cells as cell, i (i)}
					<td class="px-2 py-1 text-right font-mono text-sm whitespace-nowrap relative">
						{#if cell.skipped}
							<span class="text-severity-warning-text text-xs" title={cell.skipped}>not run</span>
						{:else if cell.trace}
							<button
								type="button"
								class="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-brand-primary"
								title="Show the equation"
								aria-expanded={open === cellKey(row.key, i)}
								onclick={() => toggle(cellKey(row.key, i))}>{fmt(cell.value)}</button
							>
							{#if open === cellKey(row.key, i)}
								{@render equation(cell)}
							{/if}
						{:else}
							{fmt(cell.value)}
						{/if}
					</td>
				{/each}
			</tr>
		{/each}
	{/if}
{/snippet}

{#if hasRows}
	<table class="w-full">
		<thead>
			<tr class="border-b border-brand-divider">
				<th class="text-left px-2 py-1 text-xs font-semibold text-brand-muted">Parameter</th>
				{#if tables.columns.length > 0}
					{#each tables.columns as column (column)}
						<th class="text-right px-2 py-1 text-xs font-semibold text-brand-muted">{column}</th>
					{/each}
				{:else}
					<th class="text-right px-2 py-1 text-xs font-semibold text-brand-muted">Value</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{@render band('Steps', tables.steps, true)}
			{@render band(tables.steps.length > 0 ? 'Outputs' : null, tables.outputs, false)}
		</tbody>
	</table>
	{#if tables.statistics.length > 0}
		<table class="w-full mt-3">
			<thead>
				<tr class="border-b border-brand-divider">
					<th class="text-left px-2 py-1 text-xs font-semibold text-brand-muted"
						>Mean and standard deviation</th
					>
					<th class="text-right px-2 py-1 text-xs font-semibold text-brand-muted">Value</th>
				</tr>
			</thead>
			<tbody>
				{#each tables.statistics as row (row.key)}
					<tr class="border-b border-brand-divider last:border-b-0">
						<td class="px-2 py-1 text-sm">
							{row.label}{#if row.units}&nbsp;<span class="text-xs text-brand-muted"
									>({row.units})</span
								>{/if}
						</td>
						<td class="px-2 py-1 text-right font-mono text-sm">{fmt(row.cells[0]?.value ?? null)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="text-[11px] text-brand-muted mt-1">
			Derived from the repeats when they are saved, and shown here rather than stored.
		</p>
	{/if}
{:else}
	<p class="text-sm text-brand-muted">No outputs were computable from these inputs.</p>
{/if}
