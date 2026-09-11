<script lang="ts">
	import type { PlanCurveAssignment, PlanInstruments } from '$api/service';
	import { formatCount } from '$lib/format';
	import { formatSignificant } from '$lib/utils';
	import { focusOnMount } from '$lib/focus';

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
	} = $props();

</script>

	<details class="text-xs text-brand-muted">
		<summary class="cursor-pointer text-brand-primary">What moving a curve does</summary>
		<p class="mt-1.5 max-w-4xl">
			A curve belongs to one instrument, so moving a curve here is what puts two columns of
			one probe (acid and no-acid, say) onto the same instrument. The instrument each
			parameter uses is chosen in Parameters.
		</p>
	</details>
	{#if planInstruments == null}
		<p class="text-sm text-brand-muted">Loading curves…</p>
	{:else if planInstruments.curves.length === 0}
		<p class="text-sm text-brand-muted">This source has replicated no standard curves.</p>
	{:else}
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-3 py-2 font-semibold">Curve</th>
					<th class="text-left px-3 py-2 font-semibold">Equation</th>
					<th class="text-left px-3 py-2 font-semibold">Source key</th>
					<th class="text-right px-3 py-2 font-semibold">Readings corrected</th>
					<th class="text-left px-3 py-2 font-semibold w-[260px]">Instrument</th>
				</tr></thead>
				<tbody>
					{#each planInstruments.curves as c (c.id)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-3 py-2">
								{#if editing === c.id}
									<input
										type="text"
										bind:value={editValue}
										onkeydown={(e) => { if (e.key === 'Enter') oncommitname(c.id, c.name); if (e.key === 'Escape') editing = null; }}
										onblur={() => oncommitname(c.id, c.name)}
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
							</td>
							<td class="px-3 py-2 font-mono text-xs">
								y = {formatSignificant(c.slope)}x {c.intercept < 0 ? '−' : '+'} {formatSignificant(Math.abs(c.intercept))}
								{#if c.r_squared != null}<span class="text-brand-muted ml-1">R² {formatSignificant(c.r_squared)}</span>{/if}
							</td>
							<td class="px-3 py-2 font-mono text-xs text-brand-muted">{c.source_key ?? '--'}</td>
							<td class="px-3 py-2 text-right text-xs {c.reading_count > 0 ? 'text-brand-text' : 'text-brand-muted'}">{formatCount(c.reading_count)}</td>
							<td class="px-3 py-2">
								<select
									value={c.pending_source_key ? planInstrumentPrefix + c.pending_source_key : c.sensor_id}
									onchange={(e) => onrehome(c, (e.target as HTMLSelectElement).value)}
									class="px-2 py-1 rounded text-xs bg-brand-surface border max-w-[240px] {c.pending_source_key ? 'border-brand-primary' : 'border-brand-divider'}"
									aria-label="Instrument for {c.name ?? c.id}"
									title={c.reading_count > 0 ? `Moving this curve changes which instrument ${formatCount(c.reading_count)} corrected readings name` : 'Move this curve to another instrument'}
								>
									{#if !labInstruments.some((s) => s.id === c.sensor_id)}
										<option value={c.sensor_id}>{c.instrument_name}</option>
									{/if}
									{#each labInstruments as s}
										<option value={s.id}>{s.name ?? s.serial_number ?? s.id}</option>
									{/each}
									{#if plannedInstruments.length > 0}
										<optgroup label="Created when this plan is applied">
											{#each plannedInstruments as p (p.sourceKey)}
												<option value={planInstrumentPrefix + p.sourceKey}>{p.name}</option>
											{/each}
										</optgroup>
									{/if}
								</select>
								{#if c.pending_source_key}
									<div class="text-[11px] text-brand-muted mt-0.5">Moves on apply</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="text-xs text-brand-muted">
			Moving a curve to an existing instrument happens now. Moving it to an instrument this
			plan creates happens when the plan is applied, in the same step that creates it.
		</p>
	{/if}
