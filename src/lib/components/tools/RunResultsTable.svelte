<script lang="ts">
	import type { RunTraceStep } from '$api/service';
	import CellEquation from './CellEquation.svelte';
	import type { RunCell, RunInputTables, RunRow, RunTables } from '$lib/tools/runTable';

	// A run as the portal reads it: parameters down, replicates across. Four tables in the order the
	// portal draws them: what the visit held, the numbers that are the same at every visit, the
	// steps of the calculation, and what it publishes with the statistics of the repeats.
	//
	// The role colours are the grid's (`$lib/visits/role.ts`): a value read is primary, a value
	// written is accent, and a step that is stored nowhere is muted.
	let {
		tables,
		inputs,
		trace = [],
	}: { tables: RunTables; inputs?: RunInputTables; trace?: RunTraceStep[] } = $props();

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
			class="absolute z-40 right-0 top-full mt-1 bg-brand-surface border border-brand-divider rounded-md shadow-lg p-3 min-w-[220px] max-w-sm w-max"
		>
			<CellEquation
				steps={trace}
				code={cell.trace.code}
				index={cell.trace.index}
				anchor={(step) => `#run-row-${step}`}
			/>
		</div>
	{/if}
{/snippet}

{#snippet givenTable(title: string, rows: RunRow[], columns: string[])}
	{#if rows.length > 0}
		<table class="w-full mb-3">
			<thead>
				<tr class="border-b border-brand-divider">
					<th class="text-left px-2 py-1 text-xs font-semibold text-brand-muted">{title}</th>
					{#if columns.length > 0}
						{#each columns as column (column)}
							<th class="text-right px-2 py-1 text-xs font-semibold text-brand-muted">{column}</th>
						{/each}
					{:else}
						<th class="text-right px-2 py-1 text-xs font-semibold text-brand-muted">Value</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.key)}
					<tr class="border-b border-brand-divider last:border-b-0 border-l-2 border-l-brand-primary">
						<td class="px-2 py-1 text-sm">
							{row.label}{#if row.note}&nbsp;<span class="text-xs text-brand-muted">({row.note})</span>{/if}
						</td>
						{#each row.cells as cell, i (i)}
							<td class="px-2 py-1 text-right font-mono text-sm whitespace-nowrap">{fmt(cell.value)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
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
				class="border-b border-brand-divider last:border-b-0 border-l-2 {muted
					? 'text-brand-muted border-l-brand-divider'
					: 'border-l-brand-accent'}"
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

{#if inputs}
	{@render givenTable('Read at the visit', inputs.visit, inputs.columns)}
	{@render givenTable('Constants, site and curves', inputs.fixed, [])}
{/if}

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
