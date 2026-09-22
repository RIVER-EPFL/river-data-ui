<script lang="ts">
	import type { PlanCurveAssignment, PlanHeldCurve, PlanInstruments } from '$api/service';
	import { formatCount } from '$lib/format';
	import { formatSignificant } from '$lib/utils';
	import { focusOnMount } from '$lib/focus';
	import { curveReachLine } from '$lib/pairing/curveReach';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { curveReviewBlocked, curveRows, curveTitle, type CurveRow } from '$lib/pairing/curveRows';
	import MappingSelect from '$components/ui/MappingSelect.svelte';
	import ReviewTable, { type ReviewFilter } from '$components/pairing/ReviewTable.svelte';

	// The plan's Curves review tab: one row per curve the source sent, held or stored. A curve
	// belongs to one instrument, so this is where two columns of one probe are put onto the same
	// one; the parameter's own instrument is Parameters'.
	let {
		planInstruments,
		labInstruments,
		plannedInstruments,
		planInstrumentPrefix,
		reviewedKeys,
		editing = $bindable(),
		editValue = $bindable(),
		oncommitname,
		onrehome,
		onattach,
		onreview,
		onmarkall,
		marking,
		query = $bindable(''),
		filter = $bindable('all'),
		page = $bindable(0),
	}: {
		/** Null while the plan's instruments are still loading. */
		planInstruments: PlanInstruments | null;
		labInstruments: Array<{ id: string; name: string | null; serial_number: string | null }>;
		/** The instruments this plan will create, offered as targets the move waits for. */
		plannedInstruments: Array<{ sourceKey: string; name: string }>;
		planInstrumentPrefix: string;
		/** The plan's reviewed keys, a curve's among them. */
		reviewedKeys: Set<string>;
		/** The curve whose name is being edited, or null. One open editor at a time. */
		editing: string | null;
		editValue: string;
		oncommitname: (curveId: string, current: string | null) => void;
		onrehome: (curve: PlanCurveAssignment, target: string) => void;
		/** Attach a held curve to an instrument id, a prefixed planned source key, or '' to clear. */
		onattach: (curve: PlanHeldCurve, target: string) => void;
		onreview: (row: CurveRow, reviewed: boolean) => void;
		onmarkall: (reviewed: boolean) => void;
		marking: boolean;
		query?: string;
		filter?: ReviewFilter;
		page?: number;
	} = $props();

	const rows = $derived(curveRows(planInstruments, reviewedKeys));
	const heldCount = $derived(planInstruments?.held_curves.length ?? 0);

	function instrumentGroups(current: { id: string; name: string } | null) {
		return [
			{ label: 'Existing instruments', options: [
				...(current && !labInstruments.some((s) => s.id === current.id) ? [{ value: `db:${current.id}`, label: current.name }] : []),
				...labInstruments.map((s) => ({ value: `db:${s.id}`, label: s.name ?? s.serial_number ?? s.id })),
			] },
			{ label: 'Will be created', options: plannedInstruments.map((p) => ({ value: planInstrumentPrefix + p.sourceKey, label: `+ ${p.name}` })) },
		];
	}
</script>

{#snippet curveCell(row: CurveRow)}
	{#if row.kind === 'stored'}
		{@const c = row.curve}
		{#if editing === c.id}
			<input
				type="text"
				bind:value={editValue}
				onkeydown={(e) => { if (e.key === 'Enter') oncommitname(c.id, c.name); if (e.key === 'Escape') editing = null; }}
				onblur={() => oncommitname(c.id, c.name)}
				aria-label="Name for {c.name ?? c.id}"
				class="px-1 py-0.5 border border-brand-primary rounded text-sm bg-brand-surface w-56"
				use:focusOnMount
			/>
		{:else}
			<button
				onclick={() => { editing = c.id; editValue = c.name ?? ''; }}
				class="bg-transparent border-0 border-b border-dashed border-brand-muted cursor-pointer text-brand-text hover:text-brand-primary hover:border-brand-primary text-left"
				title="Rename this standard curve"
			>{c.name ?? c.id}</button>
		{/if}
		<div class="text-[11px] text-brand-muted mt-0.5" title={c.corrected_sites.join(', ')}>{curveReachLine(c, timezoneStore.zone)}</div>
	{:else}
		{curveTitle(row)}
		<div class="text-[11px] text-brand-muted mt-0.5">Created when the plan is applied</div>
	{/if}
{/snippet}

{#snippet sourceCell(row: CurveRow)}
	<div class="text-xs text-brand-muted font-mono">
		{row.curve.source_key ?? '--'}
		{#if row.kind === 'held' && row.curve.name}
			<div class="text-[10px] opacity-70">{row.curve.label}</div>
		{/if}
	</div>
{/snippet}

{#snippet equationCell(row: CurveRow)}
	{@const c = row.curve}
	<span class="font-mono text-xs">
		y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}
		{#if c.r_squared != null}<span class="text-brand-muted ml-1">R² {formatSignificant(c.r_squared)}</span>{/if}
	</span>
{/snippet}

{#snippet instrumentCell(row: CurveRow)}
	{#if row.kind === 'held'}
		{@const c = row.curve}
		{@const attached = c.attached}
		<div class="w-[260px]">
			<MappingSelect
				value={attached?.instrument_source_key ? planInstrumentPrefix + attached.instrument_source_key : attached?.instrument_id ? `db:${attached.instrument_id}` : ''}
				groups={instrumentGroups(attached?.instrument_id ? { id: attached.instrument_id, name: attached.instrument_name } : null)}
				noneLabel="Not attached"
				status={!attached ? 'unset' : attached.instrument_source_key ? 'new' : 'existing'}
				ariaLabel="Instrument for {curveTitle(row)}"
				onchange={(v) => onattach(c, v.startsWith('db:') ? v.slice(3) : v)}
			/>
		</div>
		{#if !attached}
			<div class="text-[11px] text-severity-warning-text mt-0.5">Attach it before the plan can be applied</div>
		{/if}
	{:else}
		{@const c = row.curve}
		<div class="w-[260px]">
			<MappingSelect
				value={c.pending_source_key ? planInstrumentPrefix + c.pending_source_key : `db:${c.sensor_id}`}
				groups={instrumentGroups({ id: c.sensor_id, name: c.instrument_name ?? c.sensor_id })}
				status={c.pending_source_key ? 'new' : 'existing'}
				ariaLabel="Instrument for {curveTitle(row)}"
				title={c.reading_count > 0 ? `Moving this curve changes which instrument ${formatCount(c.reading_count)} corrected readings name` : undefined}
				onchange={(v) => onrehome(c, v.startsWith('db:') ? v.slice(3) : v)}
			/>
		</div>
		{#if c.pending_source_key}
			<div class="text-[11px] text-brand-muted mt-0.5">Moves on apply</div>
		{/if}
	{/if}
{/snippet}

{#snippet readingsCell(row: CurveRow)}
	{#if row.kind === 'stored'}
		<span class="text-xs {row.curve.reading_count > 0 ? 'text-brand-text' : 'text-brand-muted'}">{formatCount(row.curve.reading_count)}</span>
	{:else}
		<span class="text-xs text-brand-muted">--</span>
	{/if}
{/snippet}

{#if planInstruments == null}
	<p class="text-sm text-brand-muted">Loading curves…</p>
{:else}
	{#if heldCount > 0}
		<p class="text-sm mb-1.5">
			The source sent {heldCount} curve{heldCount === 1 ? '' : 's'} without naming an
			instrument. Attach each to the instrument that measured the values it corrects; the curve is
			created under it when the plan is applied.
		</p>
	{/if}
	<ReviewTable
		{rows}
		key={(r) => r.key}
		noun={['curve', 'curves']}
		columns={[
			{ label: 'Curve', cell: curveCell },
			{ label: 'Source key', cell: sourceCell },
			{ label: 'Equation', cell: equationCell },
			{ label: 'Instrument', cell: instrumentCell },
			{ label: 'Readings corrected', align: 'right', cell: readingsCell },
		]}
		searchText={(r) => [curveTitle(r), r.curve.source_key ?? '', r.kind === 'held' ? r.curve.label : r.curve.instrument_name].join(' ')}
		reviewed={(r) => r.reviewed}
		reviewBlocked={curveReviewBlocked}
		{onreview}
		{onmarkall}
		{marking}
		empty="This source has replicated no standard curves."
		bind:query
		bind:filter
		bind:page
	/>
{/if}
