<script lang="ts">
	import type { Snippet } from 'svelte';

	import { base } from '$app/paths';
	import type { PlanDeviceGroup, PlanInstrumentGroup, PlanInstruments } from '$api/service';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import MappingSelect, { type MappingGroup } from '$components/ui/MappingSelect.svelte';
	import type { InstrumentDecision } from '$lib/pairing/planGroups';
	import { formatSignificant } from '$lib/utils';

	// The plan's Instruments review tab: one row per instrument the plan must bind, questions
	// first, with the devices the source identifies by serial listed above as facts rather than
	// decisions.
	let {
		planInstruments,
		planDevices,
		instrumentDecisions,
		openInstrumentQuestions,
		acceptingSuggestions,
		instrumentOptions,
		instrumentValue,
		instrumentStatus,
		instrumentRowId,
		onchoose,
		onattach,
		onacceptall,
		nameField,
	}: {
		/** Null while the plan's instruments are still loading. */
		planInstruments: PlanInstruments | null;
		planDevices: PlanDeviceGroup[];
		instrumentDecisions: InstrumentDecision[];
		/** How many rows still ask something: no instrument, or a proposal nobody confirmed. */
		openInstrumentQuestions: number;
		acceptingSuggestions: boolean;
		instrumentOptions: (d: InstrumentDecision) => MappingGroup[];
		instrumentValue: (d: InstrumentDecision) => string;
		instrumentStatus: (d: InstrumentDecision) => 'existing' | 'new' | 'unset';
		/** The row's DOM id, so a question elsewhere in the wizard can scroll to it. */
		instrumentRowId: (scope: string) => string;
		onchoose: (d: InstrumentDecision, value: string) => void;
		/** Attach the named existing instrument, the other half of a name collision. */
		onattach: (d: InstrumentDecision, instrumentId: string) => void;
		onacceptall: () => void;
		/** The inline name editor, shared with the Parameters tab, so it is defined once. */
		nameField: Snippet<[string, string, string, PlanInstrumentGroup | null]>;
	} = $props();
</script>

	<details class="text-xs text-brand-muted">
		<summary class="cursor-pointer text-brand-primary">What an instrument, a serial and a curve are here</summary>
		<div class="mt-1.5 space-y-1.5 max-w-4xl">
			<p>
				Every measurement is produced by an instrument, and this is where each of this
				source's feeds gets one. A name is a label: identity is the source key, so renaming
				an instrument later breaks nothing.
			</p>
			<p>
				A device the source identifies by serial is not a decision: the serial is the
				identity. Pairing attaches the device to its feeds and opens its deployment at the
				site, one per parameter it serves.
			</p>
			<p>
				A curve is fitted on one instrument, so a reading naming a curve must name that
				instrument too. Without one, those readings are dropped at ingest rather than stored.
			</p>
		</div>
	</details>

	{#if planDevices.length > 0}
		<div class="space-y-1">
			<h3 class="text-sm font-semibold">Devices the source identifies by serial</h3>
			<p class="text-xs text-brand-muted">Stationed at one site, so each is named for the slot it serves.</p>
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-3 py-2 font-semibold">Site</th>
						<th class="text-left px-3 py-2 font-semibold">Device</th>
						<th class="text-left px-3 py-2 font-semibold">Channels</th>
						<th class="text-left px-3 py-2 font-semibold">In the inventory</th>
					</tr></thead>
					<tbody>
						{#each planDevices as d (`${d.site}:${d.serial}`)}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-3 py-2">{d.site}</td>
								<td class="px-3 py-2">
									<span class="font-mono text-xs">{d.serial}</span>
									{#if d.model}<span class="text-brand-muted text-xs ml-1">{d.model}</span>{/if}
								</td>
								<td class="px-3 py-2 text-xs text-brand-muted">
									{d.parameters.join(', ')}
									<span class="ml-1">({d.stream_count} stream{d.stream_count === 1 ? '' : 's'})</span>
								</td>
								<td class="px-3 py-2 text-xs">
									{#if d.instrument_id}
										<a href="{base}/sensors/{d.instrument_id}" class="text-brand-primary no-underline hover:underline">{d.instrument_name ?? d.serial}</a>
									{:else}
										<span class="text-brand-muted">created when the plan is applied</span>
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
			{#if openInstrumentQuestions > 0}
				<span class="text-xs text-severity-warning">
					{openInstrumentQuestions} still to decide
				</span>
				<Button size="sm" disabled={acceptingSuggestions} onclick={onacceptall} class="ml-auto">
					{acceptingSuggestions ? 'Creating…' : 'Create all suggested'}
				</Button>
			{/if}
		</div>
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-3 py-2 font-semibold">Instrument</th>
					<th class="text-left px-3 py-2 font-semibold w-[240px]">Map to</th>
					<th class="text-left px-3 py-2 font-semibold">Covers</th>
					<th class="text-left px-3 py-2 font-semibold">Curves</th>
					<th class="text-left px-3 py-2 font-semibold">Status</th>
				</tr></thead>
				<tbody>
					{#each instrumentDecisions as d (d.key)}
						{@const asking = d.group === null || (d.group.create && !d.group.confirmed)}
						<tr id={instrumentRowId(d.scope)} class="border-b border-brand-divider last:border-b-0 align-top {asking ? 'bg-severity-warning-soft' : ''}">
							<td class="px-3 py-2">
								{@render nameField(d.scope, d.anchorStreamId, d.proposedName, d.group)}
								{#if d.group?.curve_column}
									<div class="text-[11px] text-brand-muted mt-0.5">
										<span class="font-mono">{d.group.curve_column}</span> names a curve per reading
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
											<li class="font-mono text-[11px]">
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
