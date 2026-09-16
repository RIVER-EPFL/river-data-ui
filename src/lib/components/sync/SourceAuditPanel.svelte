<script lang="ts">
	import { base } from '$app/paths';

	import type { SourceAuditReport } from '$api/service';
	import { pairingPlanHref, unpairedStreamsHref } from '$lib/sync/sourceAudit';

	let { report }: { report: SourceAuditReport } = $props();

	// A clean group is the point of the audit and needs no row of its own; the list is what to look
	// at, so the clean ones collapse into the summary line.
	const flagged = $derived(
		report.groups.filter(
			(g) => g.unregistered.length > 0 || g.orphaned.length > 0 || g.unpaired.length > 0
		)
	);
	const clean = $derived(report.groups.length - flagged.length);
</script>

<div class="space-y-3 text-xs">
	<div class="flex flex-wrap gap-x-4 gap-y-1 text-brand-muted">
		<span>{report.totals.candidates} channels carried</span>
		<span>{report.totals.matched} registered here</span>
		{#if report.totals.unregistered > 0}
			<span class="text-severity-alarm">{report.totals.unregistered} not registered</span>
		{/if}
		{#if report.totals.orphaned > 0}
			<span class="text-severity-warning">{report.totals.orphaned} no longer at source</span>
		{/if}
		{#if report.totals.unpaired > 0}
			<span class="text-severity-warning">{report.totals.unpaired} unpaired</span>
		{/if}
		<span>{report.totals.declined} channels not carried</span>
	</div>

	{#if flagged.length === 0}
		<p class="text-brand-muted">
			Every carried channel is registered and paired across {report.groups.length} groups.
		</p>
	{:else}
		<p class="text-brand-muted">
			{flagged.length} of {report.groups.length} groups need attention{clean > 0
				? `, ${clean} clean`
				: ''}.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-left">
				<thead class="text-brand-muted">
					<tr>
						<th class="py-1 pr-3 font-normal">Group</th>
						<th class="py-1 pr-3 font-normal">Carried</th>
						<th class="py-1 pr-3 font-normal">Registered</th>
						<th class="py-1 font-normal">Findings</th>
					</tr>
				</thead>
				<tbody>
					{#each flagged as group (group.name)}
						<tr class="border-t border-brand-divider align-top">
							<td class="py-1 pr-3 font-medium">{group.name || '(no group)'}</td>
							<td class="py-1 pr-3">{group.candidates}</td>
							<td class="py-1 pr-3">{group.registered}</td>
							<td class="py-1 space-y-1">
								{#if group.unregistered.length > 0}
									<div>
										<span class="text-severity-alarm">Not registered:</span>
										{group.unregistered.join(', ')}
									</div>
								{/if}
								{#if group.orphaned.length > 0}
									<div>
										<span class="text-severity-warning">No longer at source:</span>
										{group.orphaned.join(', ')}
									</div>
								{/if}
								{#if group.unpaired.length > 0}
									<div>
										<span class="text-severity-warning">Unpaired:</span>
										{group.unpaired.join(', ')}
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if report.totals.unregistered > 0 || report.totals.unpaired > 0}
			<p class="text-brand-muted">
				<a class="text-brand-primary hover:underline" href={pairingPlanHref(base, report.source_system)}
					>Plan this source</a
				>, or pair one at a time from
				<a
					class="text-brand-primary hover:underline"
					href={unpairedStreamsHref(base, report.source_system)}>its unpaired streams</a
				>.
			</p>
		{/if}
	{/if}

	{#if report.curves.at_source > 0 || report.curves.registered > 0}
		<div class="text-brand-muted">
			Standard curves: {report.curves.at_source} at source, {report.curves.registered} here.
			{#if report.curves.unregistered.length > 0}
				<span class="text-severity-alarm">
					Missing here: {report.curves.unregistered.join(', ')}.
				</span>
			{/if}
			{#if report.curves.orphaned.length > 0}
				<span class="text-severity-warning">
					No longer at source: {report.curves.orphaned.join(', ')}.
				</span>
			{/if}
		</div>
	{/if}

	{#if report.declined.length > 0}
		<details>
			<summary class="cursor-pointer text-brand-muted">
				{report.declined.length} channels the connector does not carry
			</summary>
			<ul class="mt-1 space-y-0.5 text-brand-muted">
				{#each report.declined as channel (channel.channel)}
					<li><span class="font-mono">{channel.channel}</span>: {channel.reason}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
