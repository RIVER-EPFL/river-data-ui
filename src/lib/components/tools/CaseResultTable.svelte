<script lang="ts">
	// One presentation for every comparison of expectation against result: a case run in the
	// editor, a run of every case, and a stored version's validation.
	import Badge from '$components/ui/Badge.svelte';
	import ToolRunError from '$components/tools/ToolRunError.svelte';
	import type { ComparisonRow, ToolRunFailure } from '$lib/tools/draft';

	let {
		rows,
		failure = null,
		empty = 'This case names nothing to check.',
	}: {
		rows: ComparisonRow[];
		/** The script raised instead of returning; the comparison never happened. */
		failure?: ToolRunFailure | null;
		empty?: string;
	} = $props();
</script>

{#if failure}
	<ToolRunError {failure} />
{/if}

{#if rows.length > 0}
	<div class="overflow-x-auto">
		<table class="w-full text-xs">
			<thead>
				<tr class="text-left text-brand-muted border-b border-brand-divider">
					<th class="px-2 py-1 font-semibold">Output</th>
					<th class="px-2 py-1 font-semibold">Expected</th>
					<th class="px-2 py-1 font-semibold">Got</th>
					<th class="px-2 py-1 font-semibold">Difference</th>
					<th class="px-2 py-1"></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, idx (row.key + idx)}
					<tr class="border-b border-brand-divider last:border-b-0">
						<td class="px-2 py-1 font-mono">{row.key}</td>
						<td class="px-2 py-1 font-mono">{row.expected}</td>
						<td class="px-2 py-1 font-mono {row.passed ? '' : 'text-severity-alarm'}">{row.got}</td>
						<td class="px-2 py-1 font-mono text-brand-muted">{row.difference}</td>
						<td class="px-2 py-1">
							<Badge variant={row.passed ? 'ok' : 'alarm'}>{row.passed ? 'match' : 'differs'}</Badge>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if !failure}
	<p class="text-xs text-brand-muted">{empty}</p>
{/if}
