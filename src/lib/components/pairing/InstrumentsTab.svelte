<script lang="ts">
	import { base } from '$app/paths';
	import type { PlanDeviceGroup, PlanInstrumentProposal, PlanInstruments } from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import type { MappingGroup } from '$components/ui/MappingSelect.svelte';
	import NamePicker from '$components/pairing/NamePicker.svelte';
	import ReviewTable, { type ReviewFilter } from '$components/pairing/ReviewTable.svelte';
	import {
		instrumentRows,
		isAskingInstrument,
		type InstrumentDecision,
		type InstrumentRow,
	} from '$lib/pairing/planGroups';
	import { formatSignificant } from '$lib/utils';

	// The plan's Instruments review tab: one row per instrument the plan binds, the device channels
	// the source identifies by serial first, then the lab instruments.
	let {
		planInstruments,
		planDevices,
		deviceDecisions = [],
		instrumentDecisions,
		instrumentOptions,
		instrumentValue,
		instrumentStatus,
		instrumentRowId,
		coverage,
		goToParam,
		goToSite,
		onchoose,
		onattach,
		onreview,
		onmarkall,
		marking,
		canMarkUnreviewed,
		proposals = [],
		onadmit,
		query = $bindable(''),
		filter = $bindable('all'),
		page = $bindable(0),
	}: {
		/** Null while the plan's instruments are still loading. */
		planInstruments: PlanInstruments | null;
		planDevices: PlanDeviceGroup[];
		/** The device channels' instruments as decisions, one per channel that carries one. */
		deviceDecisions?: InstrumentDecision[];
		instrumentDecisions: InstrumentDecision[];
		instrumentOptions: (d: InstrumentDecision) => MappingGroup[];
		instrumentValue: (d: InstrumentDecision) => string;
		instrumentStatus: (d: InstrumentDecision) => 'existing' | 'new' | 'unset';
		/** The row's DOM id, so another tab can open the row. */
		instrumentRowId: (key: string) => string;
		/** The parameters and sites each row measures, by row key. */
		coverage: Map<string, { parameters: string[]; sites: string[] }>;
		goToParam: (paramName: string) => void;
		goToSite: (siteName: string) => void;
		/** The source's own instrument register, waiting for this plan to admit it. */
		proposals?: PlanInstrumentProposal[];
		onadmit?: (sourceKey: string, admit: boolean, attachTo?: string | null) => void;
		onchoose: (d: InstrumentDecision, value: string) => void;
		/** Attach the named existing instrument, the other half of a name collision. */
		onattach: (d: InstrumentDecision, instrumentId: string) => void;
		onreview: (d: InstrumentDecision, reviewed: boolean) => void;
		onmarkall: (reviewed: boolean) => void;
		marking: boolean;
		/** Whether any instrument's review can be taken back: an existing one has nothing to confirm. */
		canMarkUnreviewed: boolean;
		query?: string;
		filter?: ReviewFilter;
		page?: number;
	} = $props();

	const rows = $derived(instrumentRows(planDevices, deviceDecisions, instrumentDecisions));

	/** Sites a row names before the rest are counted. */
	const SITES_SHOWN = 3;

	function reviewBlocked(row: InstrumentRow): string | null {
		const d = row.decision;
		if (!d) return null;
		if (isAskingInstrument(d)) return d.nameConflict ? 'Attach it or create a second one first' : null;
		return d.group?.create ? null : 'Already in the inventory';
	}
</script>

{#snippet instrumentCell(row: InstrumentRow)}
	{@const d = row.decision}
	{#if d}
		<div class="w-[260px]">
			<NamePicker
				value={instrumentValue(d)}
				groups={instrumentOptions(d)}
				name={d.group?.name ?? d.proposedName}
				status={instrumentStatus(d)}
				noneLabel="no instrument"
				ariaLabel="Instrument for {d.parameters.join(', ')}"
				onpick={(v) => onchoose(d, v)}
				onrename={(name) => onchoose(d, `new:${name}`)}
			/>
		</div>
		{#if d.group?.curve_column}
			<div class="text-[11px] text-brand-muted mt-0.5">
				<span class="font-mono break-all">{d.group.curve_column}</span> names a curve per reading
			</div>
		{/if}
		{#if d.nameConflict}
			<div class="mt-1.5 max-w-[360px] rounded border border-severity-warning-border bg-severity-warning-soft p-2 text-[11px] text-severity-warning-text space-y-1.5">
				<div>
					<span class="font-semibold">{d.nameConflict.name}</span> already exists{d.nameConflict.source_system
						? ` (from ${d.nameConflict.source_system})`
						: ''}.
					{#if d.nameConflict.has_readings}
						<strong>It already holds readings</strong>, and attaching adds these to them.
					{:else}
						It holds no readings yet.
					{/if}
				</div>
				<div class="flex flex-wrap gap-1.5">
					<Button
						size="sm"
						onclick={() => onattach(d, d.nameConflict!.id)}
						title="These feeds' readings are added to the instrument that already carries this name"
					>Attach to it</Button>
					<Button
						size="sm"
						variant="ghost"
						onclick={() => onchoose(d, `new:${d.proposedName}`)}
						title="A second instrument is created under the same name; the two are told apart by their source"
					>Create a second one</Button>
				</div>
			</div>
		{/if}
	{:else if row.device?.instrument_id}
		<a href="{base}/sensors/{row.device.instrument_id}" class="text-brand-primary no-underline hover:underline">{row.device.instrument_name ?? row.device.serial}</a>
	{:else}
		<span class="text-brand-muted">Created when the plan is applied</span>
	{/if}
{/snippet}

{#snippet coversCell(row: InstrumentRow)}
	{@const cov = coverage.get(row.key) ?? { parameters: row.decision?.parameters ?? row.device?.parameters ?? [], sites: row.device ? [row.device.site] : [] }}
	<div class="text-xs">
		{#each cov.parameters as p, i (p)}
			<button onclick={() => goToParam(p)} class="bg-transparent border-none p-0 cursor-pointer text-brand-primary hover:underline" title="Open on the Parameters tab">{p}</button>{i < cov.parameters.length - 1 ? ', ' : ''}
		{/each}
		<div class="text-brand-muted">
			{#if cov.sites.length > 0}
				at
				{#each cov.sites.slice(0, SITES_SHOWN) as site, i (site)}
					<button onclick={() => goToSite(site)} class="bg-transparent border-none p-0 cursor-pointer text-brand-muted hover:text-brand-primary hover:underline" title="Open on the Sites tab">{site}</button>{i < Math.min(cov.sites.length, SITES_SHOWN) - 1 ? ', ' : ''}
				{/each}
				{#if cov.sites.length > SITES_SHOWN}
					<span title={cov.sites.slice(SITES_SHOWN).join(', ')}>and {cov.sites.length - SITES_SHOWN} more</span>
				{/if}
			{/if}
			{#if row.device}
				<span>, device <span class="font-mono">{row.device.serial}</span>{row.device.model ? ` ${row.device.model}` : ''}</span>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet curvesCell(row: InstrumentRow)}
	{@const group = row.decision?.group}
	<div class="text-xs">
		{#if group && group.curves.length > 0}
			<ul class="list-none p-0 m-0 space-y-0.5">
				{#each group.curves as c (c.id)}
					<li class="font-mono text-[11px] break-words">
						{c.name ?? c.id}
						<span class="text-brand-muted">y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}</span>
					</li>
				{/each}
			</ul>
		{:else if group?.stamps_readings}
			<span class="text-severity-warning">No curves registered</span>
		{:else}
			<span class="text-brand-muted">--</span>
		{/if}
	</div>
{/snippet}

{#if planInstruments == null}
	<p class="text-sm text-brand-muted">Loading instruments…</p>
{:else}
	<ReviewTable
		{rows}
		key={(r) => r.key}
		rowId={(r) => instrumentRowId(r.key)}
		noun={['instrument', 'instruments']}
		columns={[
			{ label: 'Instrument', cell: instrumentCell },
			{ label: 'Covers', cell: coversCell },
			{ label: 'Curves', cell: curvesCell },
		]}
		searchText={(r) => [r.decision?.group?.name ?? '', r.device?.serial ?? '', ...(coverage.get(r.key)?.parameters ?? []), ...(coverage.get(r.key)?.sites ?? [])].join(' ')}
		reviewed={(r) => (r.decision ? !isAskingInstrument(r.decision) : null)}
		{reviewBlocked}
		onreview={(r, reviewed) => r.decision && onreview(r.decision, reviewed)}
		{onmarkall}
		{marking}
		{canMarkUnreviewed}
		empty="No stream in this plan needs an instrument chosen."
		bind:query
		bind:filter
		bind:page
	/>
{/if}

<!-- The source's own instrument register: rows no stream mints, carrying the serial, the model and
     what the lab recorded about where it was installed. Admitted rows are created by the apply,
     like every other thing this plan makes. -->
{#if proposals.length > 0}
	<div class="mt-4 rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<div class="px-3 py-2 border-b border-brand-divider">
			<span class="text-sm font-semibold">From the source's instrument register</span>
			<span class="text-xs text-brand-muted ml-2">
				{proposals.filter((p) => p.admit).length} of {proposals.length} will be created by this
				apply, {proposals.filter((p) => p.attach_to).length} merged onto an instrument that is
				already there. A row left out stays offered, and the next plan asks again.
			</span>
		</div>
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider text-xs text-brand-muted">
					<th class="text-left px-3 py-2 font-semibold">Name</th>
					<th class="text-left px-3 py-2 font-semibold">Serial</th>
					<th class="text-left px-3 py-2 font-semibold">Model</th>
					<th class="text-left px-3 py-2 font-semibold">What the register records</th>
					<th class="text-right px-3 py-2 font-semibold">Create</th>
				</tr>
			</thead>
			<tbody>
				{#each proposals as proposal (proposal.source_key)}
					<tr class="border-b border-brand-divider last:border-b-0 {proposal.admit || proposal.attach_to ? '' : 'opacity-60'}">
						<td class="px-3 py-2">
							{proposal.name}
							<span class="block text-[11px] text-brand-muted font-mono break-all">{proposal.source_key}</span>
							{#if proposal.conflict}
								<div class="mt-1.5 rounded border border-severity-warning-border bg-severity-warning-soft p-2 text-[11px] text-severity-warning-text space-y-1.5">
									<div>
										<span class="font-semibold">{proposal.conflict.name}</span> is already in the
										inventory{proposal.conflict.source_system
											? ` (from ${proposal.conflict.source_system})`
											: ''}, under this name or this serial.
										{#if proposal.conflict.has_readings}
											<strong>It already holds readings.</strong>
										{/if}
										Creating this row leaves two of one probe.
									</div>
									<div class="flex flex-wrap gap-1.5">
										<Button
											size="sm"
											onclick={() => onadmit?.(proposal.source_key, false, proposal.conflict!.id)}
											title="The register's serial, model and metadata are merged onto the instrument that is already there"
										>
											Attach to it
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onclick={() => onadmit?.(proposal.source_key, true, null)}
											title="A second instrument is created from the register row"
										>
											Create a second one
										</Button>
									</div>
									{#if proposal.attach_to}
										<div>Attaching to it when this plan is applied.</div>
									{/if}
								</div>
							{/if}
						</td>
						<td class="px-3 py-2 font-mono text-xs break-all">{proposal.serial_number ?? '--'}</td>
						<td class="px-3 py-2 text-xs">{proposal.model ?? '--'}</td>
						<td class="px-3 py-2 text-[11px] text-brand-muted">
							{#if proposal.metadata}
								{Object.entries(proposal.metadata as Record<string, unknown>)
									.map(([k, v]) => `${k}: ${v}`)
									.join(' · ')}
							{:else}
								--
							{/if}
						</td>
						<td class="px-3 py-2 text-right">
							<input
								type="checkbox"
								checked={proposal.admit}
								disabled={proposal.attach_to !== null}
								onchange={(e) => onadmit?.(proposal.source_key, e.currentTarget.checked, null)}
								aria-label="Create {proposal.name}"
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
