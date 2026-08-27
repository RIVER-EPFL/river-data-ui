<script lang="ts">
	import type { ToolCurveSlot } from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import { blankCurve } from './manifest';

	let { curves = $bindable() }: { curves: ToolCurveSlot[] } = $props();

	const field =
		'w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs';
	// A field the server refuses to save empty reads as needing attention until it is filled.
	const missing = 'border-severity-warning-border bg-severity-warning-soft';
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface">
	<div class="flex items-center justify-between px-3 py-2 border-b border-brand-divider">
		<h5 class="text-sm font-semibold">Curve slots</h5>
		<Button size="sm" onclick={() => (curves = [...curves, blankCurve()])}>Add curve slot</Button>
	</div>
	{#if curves.length === 0}
		<p class="px-3 py-4 text-sm text-brand-muted">None declared.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-xs">
				<thead>
					<tr class="bg-brand-bg border-b border-brand-divider text-left">
						<th class="px-2 py-1.5 font-semibold">
							Name <span class="text-severity-warning" title="Required">*</span>
						</th>
						<th class="px-2 py-1.5 font-semibold">Label</th>
						<th class="px-2 py-1.5 font-semibold">Required</th>
						<th class="px-2 py-1.5"></th>
					</tr>
				</thead>
				<tbody>
					{#each curves as c, i}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="px-2 py-1.5 min-w-40">
								<input
									type="text"
									aria-label="Curve slot name"
									bind:value={curves[i].name}
									class="{field} font-mono {c.name.trim() ? '' : missing}"
								/>
							</td>
							<td class="px-2 py-1.5 min-w-48">
								<input type="text" aria-label="Curve slot label" bind:value={curves[i].label} class={field} />
							</td>
							<td class="px-2 py-1.5 text-center">
								<input
									type="checkbox"
									aria-label="Curve slot required"
									bind:checked={curves[i].required}
								/>
							</td>
							<td class="px-2 py-1.5 text-right">
								<Button
									size="sm"
									variant="ghost"
									title="Remove curve slot"
									onclick={() => (curves = curves.filter((_, j) => j !== i))}>Remove</Button
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
