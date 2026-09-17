<script lang="ts">
	import type { Snippet } from 'svelte';

	import { base } from '$app/paths';
	import type {
		PlanDeviceGroup,
		PlanInstrumentGroup,
		PlanInstrumentProposal,
		PlanInstruments,
	} from '$api/service';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import MappingSelect, { type MappingGroup } from '$components/ui/MappingSelect.svelte';
	import { isAskingInstrument, type InstrumentDecision } from '$lib/pairing/planGroups';
	import { formatSignificant } from '$lib/utils';

	// The plan's Instruments review tab: one row per instrument the plan must bind, questions
	// first, with the channels of the devices the source reports listed above, each proposing its
	// own instrument.
	let {
		planInstruments,
		planDevices,
		deviceDecisions = [],
		instrumentDecisions,
		labInstruments,
		openInstrumentQuestions,
		acceptingSuggestions,
		instrumentOptions,
		instrumentValue,
		instrumentStatus,
		instrumentRowId,
		onchoose,
		onattach,
		onassign,
		onacceptall,
		nameField,
		proposals = [],
		onadmit,
	}: {
		/** Null while the plan's instruments are still loading. */
		planInstruments: PlanInstruments | null;
		planDevices: PlanDeviceGroup[];
		/** The device channels' instruments as decisions, one per channel that carries one. */
		deviceDecisions?: InstrumentDecision[];
		instrumentDecisions: InstrumentDecision[];
		/** How many rows still ask something: no instrument, or a proposal nobody confirmed. */
		openInstrumentQuestions: number;
		acceptingSuggestions: boolean;
		instrumentOptions: (d: InstrumentDecision) => MappingGroup[];
		instrumentValue: (d: InstrumentDecision) => string;
		instrumentStatus: (d: InstrumentDecision) => 'existing' | 'new' | 'unset';
		/** The row's DOM id, so a question elsewhere in the wizard can scroll to it. */
		instrumentRowId: (scope: string) => string;
		/** The source's own instrument register, waiting for this plan to admit it. */
		proposals?: PlanInstrumentProposal[];
		onadmit?: (sourceKey: string, admit: boolean, attachTo?: string | null) => void;
		onchoose: (d: InstrumentDecision, value: string) => void;
		/** Attach the named existing instrument, the other half of a name collision. */
		onattach: (d: InstrumentDecision, instrumentId: string) => void;
		/** Attach one instrument to every selected row, in one write. */
		onassign: (rows: InstrumentDecision[], instrumentId: string) => void;
		/** The lab instruments a bulk assignment can choose from. */
		labInstruments: Array<{ id: string; name: string | null; serial_number: string | null }>;
		onacceptall: () => void;
		/** The inline name editor, shared with the Parameters tab, so it is defined once. */
		nameField: Snippet<[string, string, string, PlanInstrumentGroup | null]>;
	} = $props();

	// Selection is by decision key, so a row that disappears between renders takes its tick with it
	// rather than assigning an instrument to something the plan no longer holds.
	let selected = $state(new Set<string>());
	let assignTo = $state('');
	const keys = $derived(new Set(instrumentDecisions.map((d) => d.key)));
	const chosen = $derived(instrumentDecisions.filter((d) => selected.has(d.key)));
	const allSelected = $derived(
		instrumentDecisions.length > 0 && chosen.length === instrumentDecisions.length,
	);

	function toggle(key: string) {
		const next = new Set([...selected].filter((k) => keys.has(k)));
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selected = next;
	}

	function toggleAll() {
		selected = allSelected ? new Set() : new Set(instrumentDecisions.map((d) => d.key));
	}

	// The same write read the other way round: with an instrument chosen, this is the list of
	// parameters it will serve, which is what the instrument's own view would show.
	const covered = $derived(chosen.flatMap((d) => d.parameters));

	const deviceDecision = (d: PlanDeviceGroup) =>
		deviceDecisions.find((x) => x.anchorStreamId === d.anchor_stream_id) ?? null;

	function assign() {
		if (!assignTo || chosen.length === 0) return;
		onassign(chosen, assignTo);
		selected = new Set();
		assignTo = '';
	}
</script>

	<p class="text-sm">
		An instrument is what measured the values, so each feed needs one before its readings can say
		where they came from.
	</p>
	<details class="text-xs text-brand-muted">
		<summary class="cursor-pointer text-brand-primary">What an instrument, a serial and a curve are here</summary>
		<div class="mt-1.5 space-y-1.5 max-w-4xl">
			<p>
				Every measurement is produced by an instrument, and this is where each of this
				source's feeds gets one. A name is a label: identity is the source key, so renaming
				an instrument later breaks nothing.
			</p>
			<p>
				Each channel of a device the source reports is its own instrument, named for the site
				and parameter it serves. Pairing creates it once you accept it and opens its
				deployment at the site; the serial is shown, never matched on.
			</p>
			<p>
				A curve is fitted on one instrument, so a reading naming a curve must name that
				instrument too. Without one, those readings are dropped at ingest rather than stored.
			</p>
		</div>
	</details>

	{#if openInstrumentQuestions > 0}
		<div class="flex flex-wrap items-baseline gap-2">
			<span class="text-xs text-severity-warning">
				{openInstrumentQuestions} still to decide
			</span>
			<Button size="sm" disabled={acceptingSuggestions} onclick={onacceptall} class="ml-auto">
				{acceptingSuggestions ? 'Accepting…' : 'Accept all suggestions'}
			</Button>
		</div>
	{/if}

	{#if planDevices.length > 0}
		<div class="space-y-1">
			<h3 class="text-sm font-semibold">Devices the source identifies by serial</h3>
			<p class="text-xs text-brand-muted">Stationed at one site, so each channel is named for the slot it serves.</p>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-3 py-2 font-semibold">Site</th>
						<th class="text-left px-3 py-2 font-semibold">Device</th>
						<th class="text-left px-3 py-2 font-semibold">Channels</th>
						<th class="text-left px-3 py-2 font-semibold">Instrument</th>
						<th class="text-left px-3 py-2 font-semibold">Status</th>
					</tr></thead>
					<tbody>
						{#each planDevices as d (d.anchor_stream_id)}
							{@const decision = deviceDecision(d)}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-3 py-2">{d.site}</td>
								<td class="px-3 py-2">
									<span class="font-mono text-xs break-all">{d.serial}</span>
									{#if d.model}<span class="text-brand-muted text-xs ml-1">{d.model}</span>{/if}
								</td>
								<td class="px-3 py-2 text-xs text-brand-muted">
									{d.parameters.join(', ')}
									<span class="ml-1">({d.stream_count} stream{d.stream_count === 1 ? '' : 's'})</span>
								</td>
								<td class="px-3 py-2 text-xs">
									{#if decision}
										{@render nameField(decision.scope, decision.anchorStreamId, decision.proposedName, decision.group)}
										{#if decision.nameConflict}
											<div class="mt-1 text-[11px] text-severity-warning-text">
												<span class="font-semibold">{decision.nameConflict.name}</span> already exists; rename this one or attach it.
												<Button size="sm" variant="ghost" onclick={() => onattach(decision, decision.nameConflict!.id)}>Attach to it</Button>
											</div>
										{/if}
									{:else if d.instrument_id}
										<a href="{base}/sensors/{d.instrument_id}" class="text-brand-primary no-underline hover:underline">{d.instrument_name ?? d.serial}</a>
									{:else}
										<span class="text-brand-muted">created when the plan is applied</span>
									{/if}
								</td>
								<td class="px-3 py-2 text-xs">
									{#if decision?.group?.create && !decision.group.confirmed}
										<Badge variant="warning" title="A suggestion waiting on you. Accept it and the apply creates this instrument.">proposed</Badge>
									{:else if decision?.group?.create}
										<Badge title="Not in the inventory yet; the apply creates it.">will be created</Badge>
									{:else if decision || d.instrument_id}
										<Badge variant="ok" title="Already in the inventory; the apply attaches it to this channel.">existing</Badge>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	{#if planInstruments == null}
		<p class="text-sm text-brand-muted">Loading instruments…</p>
	{:else if instrumentDecisions.length === 0}
		<p class="text-sm text-brand-muted">
			No feed in this plan needs a lab instrument chosen{planDevices.length > 0
				? ': every one of them names a device.'
				: '.'}
		</p>
	{:else}
		<div class="flex flex-wrap items-baseline gap-2">
			<h3 class="text-sm font-semibold">Lab instruments</h3>
			<p class="w-full text-xs text-brand-muted order-last">One instrument per analyte, carried out to every station that measures it, so a row here covers all of them at once.</p>
		</div>

		{#if chosen.length > 0}
			<div class="flex flex-wrap items-center gap-2 rounded-md border border-brand-divider bg-brand-bg p-2 text-xs">
				<span class="font-semibold">{chosen.length} selected</span>
				<label class="flex items-center gap-1">
					<span class="text-brand-muted">Assign to</span>
					<select
						bind:value={assignTo}
						aria-label="Instrument to assign to the selected parameters"
						class="rounded border border-brand-divider bg-brand-surface px-1 py-0.5"
					>
						<option value="">an instrument…</option>
						{#each labInstruments as s (s.id)}
							<option value={s.id}>{s.name ?? s.serial_number ?? s.id}</option>
						{/each}
					</select>
				</label>
				<Button size="sm" disabled={!assignTo} onclick={assign}>Assign</Button>
				<Button size="sm" variant="ghost" onclick={() => (selected = new Set())}>Clear</Button>
				<span class="w-full text-brand-muted">
					It will serve {covered.join(', ')}.
				</span>
			</div>
		{/if}
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="px-3 py-2 w-8">
						<input
							type="checkbox"
							checked={allSelected}
							onchange={toggleAll}
							aria-label="Select every instrument row"
						/>
					</th>
					<th class="text-left px-3 py-2 font-semibold">Instrument</th>
					<th class="text-left px-3 py-2 font-semibold w-[240px]">Map to</th>
					<th class="text-left px-3 py-2 font-semibold">Covers</th>
					<th class="text-left px-3 py-2 font-semibold">Curves</th>
					<th class="text-left px-3 py-2 font-semibold">Status</th>
				</tr></thead>
				<tbody>
					{#each instrumentDecisions as d (d.key)}
						{@const asking = isAskingInstrument(d)}
						<tr id={instrumentRowId(d.scope)} class="border-b border-brand-divider last:border-b-0 align-top {asking ? 'bg-severity-warning-soft' : ''}">
							<td class="px-3 py-2">
								<input
									type="checkbox"
									checked={selected.has(d.key)}
									onchange={() => toggle(d.key)}
									aria-label="Select {d.parameters.join(', ')}"
								/>
							</td>
							<td class="px-3 py-2">
								{@render nameField(d.scope, d.anchorStreamId, d.proposedName, d.group)}
								{#if d.group?.curve_column}
									<div class="text-[11px] text-brand-muted mt-0.5">
										<span class="font-mono break-all">{d.group.curve_column}</span> names a curve per reading
									</div>
								{:else if d.group}
									<div class="text-[11px] text-brand-muted mt-0.5">Corrected upstream; the curve is not re-applied</div>
								{/if}
								{#if d.nameConflict}
									<div class="mt-1.5 rounded border border-severity-warning-border bg-severity-warning-soft p-2 text-[11px] text-severity-warning-text space-y-1.5">
										<div>
											<span class="font-semibold">{d.nameConflict.name}</span> already exists{d
												.nameConflict.source_system
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
											>
												Attach to it
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onclick={() => onchoose(d, `new:${d.proposedName}`)}
												title="A second instrument is created under the same name; the two are told apart by their source"
											>
												Create a second one
											</Button>
										</div>
									</div>
								{/if}
							</td>
							<td class="px-3 py-2">
								<MappingSelect
									value={instrumentValue(d)}
									groups={instrumentOptions(d)}
									noneLabel="no instrument"
									customLabel="Custom name…"
									status={instrumentStatus(d)}
									ariaLabel="Instrument for {d.parameters.join(', ')}"
									title="Attach an existing instrument, or create the one this plan proposes. Naming one always proposes it, so a choice here is reversible."
									onchange={(v) => onchoose(d, v)}
								/>
							</td>
							<td class="px-3 py-2 text-xs text-brand-muted">
								{d.parameters.join(', ')}
								<div>
									at {d.siteCount} station{d.siteCount === 1 ? '' : 's'},
									{d.streamCount} feed{d.streamCount === 1 ? '' : 's'}
								</div>
							</td>
							<td class="px-3 py-2 text-xs">
								{#if d.group && d.group.curves.length > 0}
									<ul class="list-none p-0 m-0 space-y-0.5">
										{#each d.group.curves as c (c.id)}
											<li class="font-mono text-[11px] break-words">
												{c.name ?? c.id}
												<span class="text-brand-muted">y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}</span>
											</li>
										{/each}
									</ul>
								{:else if d.group?.stamps_readings}
									<span class="text-severity-warning">no curves registered</span>
								{:else}
									<span class="text-brand-muted">--</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-xs">
								{#if d.group === null}
									<Badge variant="warning" title="Nothing is attached, so these feeds have no instrument to attribute their readings to.">not chosen</Badge>
								{:else if d.group.create && !d.group.confirmed}
									<Badge variant="warning" title="A suggestion waiting on you. Accept it and the apply mints this instrument.">proposed</Badge>
								{:else if d.group.create}
									<Badge title="Not in the inventory yet; the apply mints it.">will be created</Badge>
								{:else}
									<Badge variant="ok" title="Already in the inventory; the apply attaches it to these feeds.">existing</Badge>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
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
