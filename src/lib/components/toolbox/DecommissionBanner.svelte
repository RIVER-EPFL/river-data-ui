<script lang="ts">
	import { formatDateTime } from '$lib/utils';

	let {
		calculation,
	}: {
		calculation: {
			decommissioned_at?: string | null;
			decommissioned_by?: string | null;
			decommission_reason?: string | null;
		};
	} = $props();
</script>

{#if calculation.decommissioned_at}
	<div
		role="status"
		class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-sm text-severity-warning-text"
	>
		<p class="font-medium">
			Decommissioned {formatDateTime(calculation.decommissioned_at)}{#if calculation.decommissioned_by}
				by {calculation.decommissioned_by}{/if}
		</p>
		{#if calculation.decommission_reason}
			<p>{calculation.decommission_reason}</p>
		{/if}
		<p class="text-xs">It fires at no site. What it computed stays served, and its versions and runs stay readable here.</p>
	</div>
{/if}
