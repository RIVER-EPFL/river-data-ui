<script lang="ts">
	import type { ToolOutput } from '$api/service';
	import type { Parameter } from '$api/crud';
	import Button from '$components/ui/Button.svelte';
	import ToolParameterPicker from './ToolParameterPicker.svelte';
	import { markClass, outputField, type Severity } from '$lib/tools/validation';
	import {
		REP_SUFFIX,
		blankOutput,
		moveItem,
		resolveOutputParameter,
		sameUnits,
		withRepSuffix,
		type OutputStorage,
	} from './manifest';

	let {
		outputs = $bindable(),
		notStored = $bindable([]),
		catalog = [],
		marks = {},
		onTouch,
		onCatalogChanged = null,
	}: {
		outputs: ToolOutput[];
		/**
		 * Per row: the author chose "not stored". Held by the host because the manifest cannot carry
		 * it. A row that names no catalog parameter is not stored whatever this flag says; the flag
		 * keeps a row the author has chosen to store readable as stored while its parameter is still
		 * being picked.
		 */
		notStored?: boolean[];
		catalog?: Parameter[];
		marks?: Record<string, Severity>;
		onTouch: (target: string) => void;
		onCatalogChanged?: ((parameter: Parameter) => void | Promise<void>) | null;
	} = $props();

	const control = 'px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs';
	// `w-full` and a width utility on one element are the same property, so a control that sizes
	// itself is composed without it rather than fighting it.
	const field = `w-full ${control}`;

	const byId = $derived(new Map(catalog.map((p) => [p.id, p])));
	const byCode = $derived(new Map(catalog.map((p) => [p.code.toLowerCase(), p])));

	// Set while the author is deliberately typing units that differ from the linked parameter's.
	let unitsOverride = $state<boolean[]>([]);

	function storageOf(o: ToolOutput, i: number): OutputStorage {
		if (notStored[i]) return 'not_stored';
		return o.per_replicate ? 'replicates' : 'single';
	}

	/** Rewritten whole, so the flags stay aligned with the rows however the rows were replaced. */
	function mark(list: boolean[], i: number, value: boolean): boolean[] {
		const next = outputs.map((_, j) => list[j] ?? false);
		next[i] = value;
		return next;
	}

	function setStorage(i: number, mode: OutputStorage) {
		const o = outputs[i];
		if (mode === 'not_stored') {
			notStored = mark(notStored, i, true);
			o.per_replicate = false;
			o.key = withRepSuffix(o.key, false);
			// Nowhere to be saved, so the link is dropped rather than kept out of sight. Its units
			// stay: the manifest still declares them.
			o.parameter_id = null;
			o.suggested_parameter_code = null;
			return;
		}
		notStored = mark(notStored, i, false);
		// Non-null on the wire means display-only, so a stored row cannot carry a summary source.
		o.aggregate_of = null;
		o.per_replicate = mode === 'replicates';
		// The key is the contract with the runner's result keys, so the placeholder moves with the
		// mode rather than being left for the author to remember.
		o.key = withRepSuffix(o.key, o.per_replicate);
	}

	/**
	 * A row's units and its parameter are one decision: a linked output takes the catalog's units,
	 * and an author who types different ones is overriding rather than filling in a blank.
	 */
	function onLinkChanged(i: number, parameter: Parameter | null) {
		unitsOverride = mark(unitsOverride, i, false);
		if (parameter) notStored = mark(notStored, i, false);
		if (parameter && !(outputs[i].units ?? '').trim())
			outputs[i].units = parameter.default_units || null;
		onTouch(outputField(i, 'parameter'));
	}

	function useCatalogUnits(i: number, parameter: Parameter) {
		outputs[i].units = parameter.default_units || null;
		unitsOverride = mark(unitsOverride, i, false);
	}

	function addRow() {
		outputs = [...outputs, blankOutput()];
		notStored = [...notStored, false];
		unitsOverride = [...unitsOverride, false];
	}

	function removeRow(i: number) {
		outputs = outputs.filter((_, j) => j !== i);
		notStored = notStored.filter((_, j) => j !== i);
		unitsOverride = unitsOverride.filter((_, j) => j !== i);
	}

	function move(i: number, to: number) {
		outputs = moveItem(outputs, i, to);
		notStored = moveItem(notStored, i, to);
		unitsOverride = moveItem(unitsOverride, i, to);
	}
</script>

{#if outputs.length === 0}
	<p class="px-3 py-3 text-sm text-brand-muted">None declared.</p>
{:else}
	<div class="divide-y divide-brand-divider text-xs">
		{#each outputs as o, i}
			{@const storage = storageOf(o, i)}
			{@const stored = storage !== 'not_stored'}
			{@const resolution = resolveOutputParameter(o, byId, byCode)}
			{@const linked = stored ? resolution.parameter : null}
			{@const inherits = !!linked && !unitsOverride[i] && sameUnits(o.units, linked.default_units)}
			<div class="px-3 py-2 space-y-1.5">
				<div class="flex flex-wrap items-center gap-1.5">
					<input
						id={outputField(i, 'key')}
						type="text"
						aria-label="Output key"
						bind:value={outputs[i].key}
						onblur={() => onTouch(outputField(i, 'key'))}
						placeholder="key"
						class="flex-1 min-w-40 {field} font-mono {markClass(marks[outputField(i, 'key')])}"
					/>
					<input
						id={outputField(i, 'label')}
						type="text"
						aria-label="Output label"
						bind:value={outputs[i].label}
						onblur={() => onTouch(outputField(i, 'label'))}
						placeholder="label"
						class="flex-1 min-w-32 {field} {markClass(marks[outputField(i, 'label')])}"
					/>
					<Button
						size="sm"
						variant="ghost"
						title="Move up"
						disabled={i === 0}
						onclick={() => move(i, i - 1)}>↑</Button
					>
					<Button
						size="sm"
						variant="ghost"
						title="Move down"
						disabled={i === outputs.length - 1}
						onclick={() => move(i, i + 1)}>↓</Button
					>
					<Button size="sm" variant="ghost" title="Remove output" onclick={() => removeRow(i)}>
						&times;
					</Button>
				</div>

				<div class="flex flex-wrap items-start gap-x-3 gap-y-1.5">
					<div class="w-28 shrink-0">
						<label for={outputField(i, 'units')} class="text-brand-muted">Units</label>
						{#if inherits}
							<!-- Read from the catalog rather than asked for twice: two spellings of one
							     quantity is a value stored in a unit the catalog does not claim. -->
							<div
								id={outputField(i, 'units')}
								class="px-2 py-1 rounded-md bg-brand-bg text-brand-muted truncate"
							>
								{linked?.default_units || 'none'}
							</div>
							<button
								type="button"
								class="text-brand-primary hover:underline"
								onclick={() => (unitsOverride = mark(unitsOverride, i, true))}>Override</button
							>
						{:else}
							<input
								id={outputField(i, 'units')}
								type="text"
								aria-label="Output units"
								value={o.units ?? ''}
								oninput={(e) => (outputs[i].units = e.currentTarget.value.trim() || null)}
								onblur={() => onTouch(outputField(i, 'units'))}
								class="{field} {markClass(marks[outputField(i, 'units')])}"
							/>
							{#if linked && !sameUnits(o.units, linked.default_units)}
								<button
									type="button"
									class="text-brand-primary hover:underline"
									title="{linked.code} is {linked.default_units || 'unitless'}"
									onclick={() => linked && useCatalogUnits(i, linked)}
									>Use {linked.default_units || 'none'}</button
								>
							{/if}
						{/if}
					</div>

					<div class="grow min-w-48">
						<label for={outputField(i, 'storage')} class="text-brand-muted">Storage</label>
						<div class="flex items-center gap-1.5">
							<select
								id={outputField(i, 'storage')}
								aria-label="How {o.key || 'this output'} is stored"
								value={storage}
								onchange={(e) => setStorage(i, e.currentTarget.value as OutputStorage)}
								class="{control} w-36 shrink-0 {markClass(marks[outputField(i, 'storage')])}"
							>
								<option value="replicates">Replicate series</option>
								<option value="single">Single value</option>
								<option value="not_stored">Not stored</option>
							</select>
							{#if storage === 'not_stored'}
								<!-- Optional: a summary names what it summarises, a diagnostic summarises
								     nothing and names nothing. -->
								<select
									aria-label="What {o.key || 'this output'} summarises"
									title="Optional: the output this value summarises"
									value={o.aggregate_of ?? ''}
									onchange={(e) => (outputs[i].aggregate_of = e.currentTarget.value || null)}
									class="{control} grow basis-28 min-w-0"
								>
									<option value="">Summarises nothing</option>
									{#each outputs.filter((_, j) => j !== i) as other}
										{#if other.key}<option value={other.key}>Summarises {other.key}</option>{/if}
									{/each}
									<!-- Shipped manifests also use a free-form marker here, so a value that
									     names no output is kept rather than dropped. -->
									{#if o.aggregate_of && !outputs.some((other, j) => j !== i && other.key === o.aggregate_of)}
										<option value={o.aggregate_of}>Summarises {o.aggregate_of}</option>
									{/if}
								</select>
							{/if}
						</div>
					</div>

					<div class="grow min-w-48">
						<span class="text-brand-muted">Parameter</span>
						{#if stored}
							<div id={outputField(i, 'parameter')}>
								<ToolParameterPicker
									bind:parameterId={outputs[i].parameter_id}
									bind:code={outputs[i].suggested_parameter_code}
									{catalog}
									{resolution}
									mark={marks[outputField(i, 'parameter')]}
									declaredUnits={o.units}
									wantedCode={o.key.replace(/_?\{rep\}/, '')}
									wantedLabel={o.label}
									ariaLabel="Parameter for {o.key || 'this output'}"
									onSelect={(p) => onLinkChanged(i, p)}
									onCreated={onCatalogChanged}
								/>
							</div>
						{:else}
							<p class="px-2 py-1 text-brand-muted">Not saved</p>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

<div class="flex items-center justify-between gap-2 px-3 py-2 border-t border-brand-divider">
	<span class="text-xs text-brand-muted" title="The runner returns one result per replicate letter">
		A replicate key carries <span class="font-mono">{REP_SUFFIX}</span>
	</span>
	<Button size="sm" onclick={addRow}>Add output</Button>
</div>
