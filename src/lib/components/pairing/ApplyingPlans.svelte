<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import { formatCount } from '$lib/format';
	import { formatRelativeTime } from '$lib/utils';
	import type { PairingPlanListing } from '$lib/api/service';

	// A plan commits its pairing first and its history in batches, so an apply that gave up leaves
	// the plan applying with part of its history attributed. Applying it again resumes from there.
	let {
		plans,
		resumingId = '',
		onresume,
	}: {
		plans: PairingPlanListing[];
		resumingId?: string;
		onresume: (plan: PairingPlanListing) => void;
	} = $props();
</script>

{#if plans.length > 0}
	<div class="rounded-md border border-severity-warning-border bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<tbody>
				{#each plans as plan (plan.id)}
					{@const running = plan.apply_in_flight || plan.id === resumingId}
					<tr class="border-b border-brand-divider last:border-b-0">
						<td class="px-4 py-3 font-semibold">
							{plan.source_system}
							<div class="text-xs font-normal text-brand-muted pt-0.5">
								Plan started {formatRelativeTime(plan.created_at)}: streams paired,
								{formatCount(plan.readings_backfilled ?? 0)} readings of history attributed so far
							</div>
							{#if !running}
								<div class="text-xs font-normal text-severity-warning pt-0.5">
									Its apply stopped before the history was complete.
								</div>
							{/if}
						</td>
						<td class="px-4 py-3 text-right whitespace-nowrap">
							{#if running}
								<span class="text-brand-muted">Applying…</span>
							{:else}
								<Button size="sm" onclick={() => onresume(plan)}>Resume</Button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
