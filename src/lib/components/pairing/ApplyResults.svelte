<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import { formatCount } from '$lib/format';
	import type { PairingPlanApplyResult } from '$lib/api/service';

	// What the apply recorded, read from the plan rather than from the call that started it: the
	// operator is handed back to the list while the job runs, so these counts are reached
	// afterwards, by URL, however long the run took.
	let {
		result,
		reverting = false,
		ondone,
		onrevert,
	}: {
		result: PairingPlanApplyResult;
		reverting?: boolean;
		ondone: () => void;
		onrevert: () => void;
	} = $props();

	const cells = $derived([
		['Projects created', String(result.projects_created)],
		['Sites created', String(result.sites_created)],
		['Parameters created', String(result.parameters_created)],
		['Site-parameters created', String(result.site_parameters_created)],
		['Instruments created', String(result.instruments_created)],
		['Parameter groups created', String(result.groups_created ?? 0)],
		['Parameters placed in a group', String(result.group_members_created ?? 0)],
		['Streams paired', formatCount(result.streams_paired)],
		['Readings backfilled', formatCount(result.readings_backfilled)],
	]);
</script>

<div class="space-y-4 max-w-xl mx-auto">
	<h2 class="text-xl font-semibold">Plan Applied</h2>

	<div class="rounded-md border border-severity-ok bg-severity-ok-soft p-6 space-y-4">
		<div class="grid grid-cols-2 gap-3 text-sm">
			{#each cells as [label, value] (label)}
				<div>
					<span class="text-brand-muted block text-xs">{label}</span>
					<span class="text-lg font-semibold {label === 'Streams paired' ? 'text-severity-ok' : ''}">{value}</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="flex gap-3">
		<Button variant="primary" onclick={ondone} class="px-4 py-2 font-semibold">Done</Button>
		<ConfirmPopover message="Revert this plan? All pairings will be undone. Projects, sites, and parameters created by the plan are kept." confirmLabel="Revert" onconfirm={onrevert}>
			<button disabled={reverting} class="px-4 py-2 border border-severity-alarm text-severity-alarm rounded-md text-sm cursor-pointer bg-transparent disabled:opacity-50">
				{reverting ? 'Reverting…' : 'Revert Plan'}
			</button>
		</ConfirmPopover>
	</div>
</div>
