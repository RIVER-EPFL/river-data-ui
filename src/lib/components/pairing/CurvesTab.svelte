<script lang="ts">
	import type { PlanCurveAssignment, PlanInstruments } from '$api/service';
	import { formatCount } from '$lib/format';
	import { formatSignificant } from '$lib/utils';
	import { focusOnMount } from '$lib/focus';
	import { curveReachLine } from '$lib/pairing/curveReach';
	import MappingSelect from '$components/ui/MappingSelect.svelte';
	import ReviewTable from '$components/pairing/ReviewTable.svelte';
	import type { PlanCurveAssignment as Curve } from '$api/service';

	// The plan's Curves review tab. A curve belongs to one instrument, so this tab is where two
	// columns of one probe are put onto the same one; the parameter's own instrument is Parameters'.
	let {
		planInstruments,
		labInstruments,
		plannedInstruments,
		planInstrumentPrefix,
		editing = $bindable(),
		editValue = $bindable(),
		oncommitname,
		onrehome,
		query = $bindable(''),
		page = $bindable(0),
	}: {
		/** Null while the plan's instruments are still loading. */
		planInstruments: PlanInstruments | null;
		labInstruments: Array<{ id: string; name: string | null; serial_number: string | null }>;
		/** The instruments this plan will create, offered as targets the move waits for. */
		plannedInstruments: Array<{ sourceKey: string; name: string }>;
		planInstrumentPrefix: string;
		/** The curve whose name is being edited, or null. One open editor at a time. */
		editing: string | null;
		editValue: string;
		oncommitname: (curveId: string, current: string | null) => void;
		onrehome: (curve: PlanCurveAssignment, target: string) => void;
		query?: string;
		page?: number;
	} = $props();
</script>

{#snippet curveCell(c: Curve)}
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
	<div class="text-[11px] text-brand-muted mt-0.5" title={c.corrected_sites.join(', ')}>{curveReachLine(c)}</div>
{/snippet}

{#snippet equationCell(c: Curve)}
	<span class="font-mono text-xs">
		y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}
		{#if c.r_squared != null}<span class="text-brand-muted ml-1">R² {formatSignificant(c.r_squared)}</span>{/if}
	</span>
{/snippet}

{#snippet sourceCell(c: Curve)}
	<span class="font-mono text-xs text-brand-muted">{c.source_key ?? '--'}</span>
{/snippet}

{#snippet readingsCell(c: Curve)}
	<span class="text-xs {c.reading_count > 0 ? 'text-brand-text' : 'text-brand-muted'}">{formatCount(c.reading_count)}</span>
{/snippet}

{#snippet instrumentCell(c: Curve)}
	<div class="w-[260px]">
		<MappingSelect
			value={c.pending_source_key ? planInstrumentPrefix + c.pending_source_key : `db:${c.sensor_id}`}
			groups={[
				{ label: 'Existing instruments', options: [
					...(labInstruments.some((s) => s.id === c.sensor_id) ? [] : [{ value: `db:${c.sensor_id}`, label: c.instrument_name }]),
					...labInstruments.map((s) => ({ value: `db:${s.id}`, label: s.name ?? s.serial_number ?? s.id })),
				] },
				{ label: 'Will be created', options: plannedInstruments.map((p) => ({ value: planInstrumentPrefix + p.sourceKey, label: `+ ${p.name}` })) },
			]}
			status={c.pending_source_key ? 'new' : 'existing'}
			ariaLabel="Instrument for {c.name ?? c.id}"
			title={c.reading_count > 0 ? `Moving this curve changes which instrument ${formatCount(c.reading_count)} corrected readings name` : undefined}
			onchange={(v) => onrehome(c, v.startsWith('db:') ? v.slice(3) : v)}
		/>
	</div>
	{#if c.pending_source_key}
		<div class="text-[11px] text-brand-muted mt-0.5">Moves on apply</div>
	{/if}
{/snippet}

{#if planInstruments == null}
	<p class="text-sm text-brand-muted">Loading curves…</p>
{:else}
	<ReviewTable
		rows={planInstruments.curves}
		key={(c) => c.id}
		noun={['curve', 'curves']}
		columns={[
			{ label: 'Curve', cell: curveCell },
			{ label: 'Instrument', cell: instrumentCell },
			{ label: 'Equation', cell: equationCell },
			{ label: 'Source key', cell: sourceCell },
			{ label: 'Readings corrected', align: 'right', cell: readingsCell },
		]}
		searchText={(c) => `${c.name ?? ''} ${c.instrument_name ?? ''} ${c.source_key ?? ''}`}
		empty="This source has replicated no standard curves."
		bind:query
		bind:page
	/>
{/if}
