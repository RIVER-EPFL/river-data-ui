<script lang="ts">
	import { tick } from 'svelte';
	import { base } from '$app/paths';
	import type { Constant } from '$api/crud';
	import type { RunTraceStep, StepDependents } from '$api/service';
	import type { EditableFormula } from '$lib/calculations/editor';
	import { linksOf, type SheetRow, type SheetSelection } from '$lib/calculations/sheet';
	import { perReplicateChoices } from '$lib/derivedParameters';
	import { identifiers, type Diagnostic } from '$lib/formula/lint';
	import type { DragPayload } from '$components/formula/ast';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import VisualFormulaBuilder from '$components/formula/VisualFormulaBuilder.svelte';
	import CellEquation from '$components/tools/CellEquation.svelte';

	// The selected cell in full: what its row is, the formula behind it where there is one, and
	// the arithmetic that produced the number. The links are the way around the calculation: a
	// chip selects the row it names.

	let {
		row = null,
		selection = null,
		formula = $bindable(null),
		formulas,
		variables,
		constants = [],
		trace = [],
		diagnostics = $bindable([]),
		consequence = null,
		dependents = null,
		busy = false,
		held = null,
		onselect,
		onedited,
		ondrop,
		onstopreading,
		onshowdependents,
		onhold,
	}: {
		row?: SheetRow | null;
		selection?: SheetSelection | null;
		/** The formula the selected row computes, edited in place. Null on an input row. */
		formula?: EditableFormula | null;
		formulas: EditableFormula[];
		variables: Array<{ name: string; label: string; category?: string }>;
		constants?: Constant[];
		trace?: RunTraceStep[];
		diagnostics?: Diagnostic[];
		/** What the save does to the values the active version produced. */
		consequence?: string | null;
		dependents?: StepDependents | null;
		busy?: boolean;
		/**
		 * For an input the set may hold between visits (Q230), whether it holds it. Null where the
		 * rule does not apply to the selected row, and the panel says nothing about it.
		 */
		held?: boolean | null;
		/** Select the row a link names. */
		onselect?: (key: string) => void;
		/** Hold this input between visits, or read it at the instant again. */
		onhold?: (held: boolean) => void;
		/** A field changed, so the run is stale. */
		onedited?: () => void;
		ondrop?: (formula: EditableFormula) => void;
		onstopreading?: (formula: EditableFormula) => void;
		onshowdependents?: (formula: EditableFormula) => void;
	} = $props();

	let builder = $state<VisualFormulaBuilder | null>(null);

	/** Open the formula of the row just selected for typing, once the panel has drawn it. */
	export async function editFormula() {
		await tick();
		builder?.focus();
	}

	/** Hand a palette pick to the formula open here. False when no formula is open to take it. */
	export function pick(payload: DragPayload): boolean {
		if (!builder) return false;
		builder.pick(payload);
		return true;
	}

	const shared = $derived(Boolean(formula?.declarationId) && Boolean(formula?.shared));
	const links = $derived(formula ? linksOf(formulas, formula.code) : { reads: [], readBy: [] });
	// An input's readers are the formulas naming it; a formula's are what `linksOf` gives.
	const readBy = $derived(
		formula
			? links.readBy
			: formulas
					.filter((f) => identifiers(f.formula).some((i) => i.name === row?.key))
					.map((f) => f.code.trim())
					.filter(Boolean),
	);
	const reads = $derived(
		formula ? [...new Set(identifiers(formula.formula).map((i) => i.name))] : [],
	);
	/** The codes a formula may read as steps: every other formula of the set. */
	const stepsBefore = $derived(
		formulas.map((f) => f.code.trim()).filter((code) => code && code !== formula?.code.trim()),
	);
	const index = $derived(
		selection && selection.column > 0 && row?.cells.length && row.cells.length > 1
			? selection.column - 1
			: null,
	);

	const inputCls =
		'w-full px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface text-brand-text';
</script>

{#snippet chips(title: string, codes: string[])}
	{#if codes.length > 0}
		<p class="text-xs text-brand-muted">
			{title}
			{#each codes as code (code)}
				<button
					type="button"
					class="ml-1 font-mono text-brand-primary bg-transparent border-none p-0 cursor-pointer hover:underline"
					onclick={() => onselect?.(code)}>{code}</button>
			{/each}
		</p>
	{/if}
{/snippet}

{#snippet whose(step: EditableFormula)}
	<!-- Whose the step is. A shared one belongs to no calculation, so the save writes it on its
	     own and declares it here rather than into the set. -->
	<label class="col-span-2 block text-xs text-brand-muted">Read by
		<select bind:value={step.shared} class={inputCls}>
			<option value={false}>This calculation only</option>
			<option value={true}>Any calculation that declares it</option>
		</select>
		<span class="mt-1 block text-[11px] text-brand-muted">
			{step.shared
				? 'Written on its own, belonging to no calculation, and brought into this one. Editing it later changes it everywhere it is read.'
				: step.declarationId
					? 'Saved back into this calculation as its own. Refused while another calculation still reads it.'
					: 'Written into this calculation, and read by its formulas alone.'}
		</span>
	</label>
{/snippet}

<section class="@container rounded-md border border-brand-divider bg-brand-surface">
	<div class="px-3 py-2 border-b border-brand-divider">
		<h3 class="text-sm font-semibold">
			{row?.label ?? (formula ? formula.code || 'New formula' : 'No cell selected')}
			{#if shared}<Badge variant="accent">shared</Badge>{/if}
			{#if row?.unused}<Badge variant="warning">read by nothing</Badge>{/if}
		</h3>
		<p class="text-xs text-brand-muted">
			{#if !row && !formula}
				Select a cell to see what made it and to edit the formula behind it.
			{:else if formula}
				{shared ? 'A step belonging to no calculation, read here.' : 'The formula this row computes.'}
			{:else}
				{row?.note ?? 'A value the run was given.'}
			{/if}
		</p>
	</div>

	{#if row || formula}
		<div class="px-3 py-3 space-y-3">
			{#if formula}
				<!-- The row's own fields beside its formula where the panel is wide enough, and above it
				     in the pane beside the sheet. -->
				<div class="grid grid-cols-1 @3xl:grid-cols-[24rem_minmax(0,1fr)] gap-3 items-start">
					<div class="grid min-w-0 grid-cols-2 gap-2">
						<label class="block text-xs text-brand-muted">Code
							<input bind:value={formula.code} placeholder="CO2_HS_Um" class={inputCls} disabled={!!formula.codeLocked} title={formula.codeLocked ?? ''} />
							{#if formula.codeLocked}
								<span class="mt-1 block text-[11px] text-brand-muted">Published: {formula.codeLocked}. The code is the CSV column header and the public identifier.</span>
							{/if}
						</label>
						<label class="block text-xs text-brand-muted">Name
							<input bind:value={formula.name} placeholder="CO2 headspace" class={inputCls} />
						</label>
						<label class="block text-xs text-brand-muted">Units
							<input bind:value={formula.units} placeholder="uM" class={inputCls} />
						</label>
						<label class="block text-xs text-brand-muted">Curve slot
							<input bind:value={formula.curve_slot} placeholder="doc" class={inputCls} />
						</label>
						<label class="col-span-2 block text-xs text-brand-muted">Description
							<input bind:value={formula.description} placeholder="The portal function this transcribes, and what it assumes" class={inputCls} />
						</label>
						<label class="col-span-2 block text-xs text-brand-muted">Per replicate over
							<select bind:value={formula.per_replicate} class={inputCls}>
								<option value="">Not per replicate, one value per visit</option>
								{#each perReplicateChoices([...new Set(identifiers(formula.formula).map((i) => i.name))]) as variable (variable)}
									<option value={variable}>{variable}</option>
								{/each}
								{#if formula.per_replicate && !identifiers(formula.formula).some((i) => i.name === formula!.per_replicate)}
									<option value={formula.per_replicate}>{formula.per_replicate} (not in the formula)</option>
								{/if}
							</select>
						</label>
						{#if shared}
							<p class="col-span-2 text-xs text-brand-muted">
								Stored once and read by every calculation that declares it, so a change saved here
								is what each of them computes.
							</p>
							{@render whose(formula)}
						{:else}
							<label class="col-span-2 flex items-start gap-2 text-sm">
								<input type="checkbox" bind:checked={formula.intermediate} class="mt-1" />
								<span>A step of the calculation
									<span class="block text-xs text-brand-muted">Handed to the formulas after it under its code, stored nowhere.</span>
									{#if consequence}<span class="block text-xs text-brand-muted">{consequence}</span>{/if}
								</span>
							</label>
							{#if formula.intermediate}
								{@render whose(formula)}
							{:else}
								<!-- The output parameter's own bounds: its `alarm_thresholds` row with no site, which
								     a site-specific row overrides. -->
								<fieldset class="col-span-2 border border-brand-divider rounded px-2 py-2">
									<legend class="text-xs text-brand-muted px-1">Bounds on {formula.code || 'the output'}</legend>
									<div class="grid grid-cols-4 gap-2">
										<label class="text-xs text-brand-muted">Warning min
											<input type="number" step="any" bind:value={formula.thresholds.warningMin} class={inputCls} />
										</label>
										<label class="text-xs text-brand-muted">Warning max
											<input type="number" step="any" bind:value={formula.thresholds.warningMax} class={inputCls} />
										</label>
										<label class="text-xs text-brand-muted">Alarm min
											<input type="number" step="any" bind:value={formula.thresholds.alarmMin} class={inputCls} />
										</label>
										<label class="text-xs text-brand-muted">Alarm max
											<input type="number" step="any" bind:value={formula.thresholds.alarmMax} class={inputCls} />
										</label>
									</div>
									<p class="mt-1 text-[11px] text-brand-muted">Written when the set is saved. A site with bounds of its own keeps them.</p>
								</fieldset>
							{/if}
						{/if}
						<div class="col-span-2 flex flex-wrap gap-2">
							<Button size="sm" disabled={busy} onclick={() => onedited?.()}>Read it at the visit again</Button>
							{#if shared}
								<Button size="sm" variant="ghost" disabled={busy} onclick={() => onshowdependents?.(formula!)}>What it feeds</Button>
								<ConfirmPopover message="Stop reading {formula.code} in this calculation? The step itself stays." confirmLabel="Stop reading" onconfirm={() => onstopreading?.(formula!)}>
									<Button size="sm" variant="ghost" disabled={busy}>Stop reading</Button>
								</ConfirmPopover>
							{:else if !formula.declarationId}
								<ConfirmPopover message="Drop {formula.code || 'this formula'} from the calculation? The save deletes it." confirmLabel="Drop" onconfirm={() => ondrop?.(formula!)}>
									<Button size="sm" variant="ghost" disabled={busy}>Drop</Button>
								</ConfirmPopover>
							{/if}
						</div>
					</div>
					<div class="min-w-0 space-y-2">
						<!-- The builder holds its formula as a tree, so another row opens a fresh one. -->
						{#key formula}
						<VisualFormulaBuilder
							bind:this={builder}
							bind:value={formula.formula}
							bind:diagnostics
							{variables}
							{constants}
							steps={stepsBefore}
							hasCurve={formula.curve_slot.trim().length > 0}
							ownCode={formula.code || undefined}
							palette={false}
						/>
						{/key}
						{#each diagnostics as diagnostic, i (i)}
							<p class="text-xs text-severity-alarm">{diagnostic.message}</p>
						{/each}
					</div>
				</div>
				{#if shared && dependents}
					<ul class="text-xs">
						{#each dependents.calculations as reader (reader.tool_script_id)}
							<li>
								<a href="{base}/toolbox/{reader.tool_script_id}" class="text-brand-primary no-underline hover:underline">{reader.label || reader.name}</a>
								<span class="text-brand-muted">{reader.formulas.map((r) => r.code).join(', ') || 'no formula names it yet'}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}

			{#if held !== null}
				<!-- How the set reaches this input (Q230). A calculation on a stream reading a value the
				     lab measures at a visit has nothing at most of its instants, unless it holds the
				     last one. -->
				<label class="block text-xs text-brand-muted">Between visits
					<select
						aria-label="Between visits"
						value={held ? 'hold' : 'exact'}
						onchange={(e) => onhold?.((e.currentTarget as HTMLSelectElement).value === 'hold')}
						disabled={busy}
						class={inputCls}
					>
						<option value="exact">Read at the instant computed</option>
						<option value="hold">Hold the last value measured</option>
					</select>
					<span class="mt-1 block text-[11px] text-brand-muted">
						{held
							? 'Every value computed between visits carries the number last measured, until the next visit measures a new one.'
							: 'An instant with no reading of it computes nothing.'}
					</span>
				</label>
			{/if}

			{@render chips('Reads', reads)}
			{@render chips('Read by', readBy)}

			{#if row?.code && trace.length > 0}
				<div class="rounded-md border border-brand-divider bg-brand-bg px-2 py-2">
					<CellEquation steps={trace} code={row.code} {index} />
				</div>
			{/if}
		</div>
	{/if}
</section>
