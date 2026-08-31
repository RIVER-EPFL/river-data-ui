<script lang="ts">
	// The one input form a tool manifest produces. Both the Tools page and the manifest editor's
	// live preview render through here, so the preview is the form an operator will meet rather
	// than an approximation of it.
	import Button from '$components/ui/Button.svelte';
	import CurvePicker, { type CurveSelection } from '$components/tools/CurvePicker.svelte';
	import {
		advisoryNote,
		buildPlan,
		conditionInputs,
		emptyStructRows,
		enumVariants,
		num,
		paramRequired,
		type FormState,
		type ToolFormSpec,
	} from '$lib/tools/form';
	import { listCell, rowLabelFor, slotCell, withAddedField, type StructShape } from '$lib/tools/shapes';

	let {
		spec,
		form = $bindable(),
		curveSelections = $bindable(),
		idPrefix = 'tp',
	}: {
		spec: ToolFormSpec;
		form: FormState;
		curveSelections: Record<string, CurveSelection>;
		/** Keeps input ids unique when two forms share a page. */
		idPrefix?: string;
	} = $props();

	let newColumn = $state<Record<string, string>>({});

	const inputsForConditions = $derived(conditionInputs(spec, form));
	const plan = $derived(buildPlan(spec, form));

	function addArrayRow(name: string) {
		form.arrays[name] = [...(form.arrays[name] ?? []), ''];
	}
	function removeArrayRow(name: string, idx: number) {
		form.arrays[name] = (form.arrays[name] ?? []).filter((_, i) => i !== idx);
	}
	function addSeriesRow(title: string, params: string[]) {
		form.series[title] = [
			...(form.series[title] ?? []),
			Object.fromEntries(params.map((p) => [p, ''])),
		];
	}
	function removeSeriesRow(title: string, idx: number) {
		form.series[title] = (form.series[title] ?? []).filter((_, i) => i !== idx);
	}
	function addStructRow(name: string, shape: StructShape) {
		if (shape.maxRows !== null && (form.structs[name]?.length ?? 0) >= shape.maxRows) return;
		form.structs[name] = [...(form.structs[name] ?? []), emptyStructRows(shape)[0]];
	}
	function removeStructRow(name: string, idx: number) {
		form.structs[name] = (form.structs[name] ?? []).filter((_, i) => i !== idx);
	}
	function addStructColumn(name: string) {
		const column = (newColumn[name] ?? '').trim();
		const shape = form.shapes[name];
		if (!column || !shape || shape.fields.some((f) => f.name === column)) return;
		form.shapes[name] = withAddedField(shape, column);
		form.structs[name] = (form.structs[name] ?? []).map((row) => ({ ...row, [column]: '' }));
		newColumn[name] = '';
	}

	function difference(row: Record<string, string>, minuend: string, subtrahend: string) {
		const a = num(row[minuend]);
		const b = num(row[subtrahend]);
		return a !== null && b !== null ? a - b : null;
	}

	function unitSuffix(units: string | null | undefined): string {
		return units ? ` (${units})` : '';
	}
</script>

{#snippet paramHeading(label: string, units: string | null, required: boolean, note: string | null)}
	<span class="text-sm font-medium">
		{label}
		{#if units}<span class="text-brand-muted font-normal">({units})</span>{/if}
		{#if required}<span class="text-severity-alarm">*</span>{/if}
	</span>
	{#if note}<p class="text-xs text-brand-muted">Applies when: {note}</p>{/if}
{/snippet}

<div class="space-y-3">
	{#each plan as item (item.type === 'series' || item.type === 'matrix' ? item.group.title : item.param.name)}
		{#if item.type === 'scalar'}
			{@const p = item.param}
			<div class="flex flex-col gap-1">
				<label for="{idPrefix}-{p.name}" class="text-sm font-medium">
					{p.label}
					{#if p.units}<span class="text-brand-muted font-normal">({p.units})</span>{/if}
					{#if paramRequired(p, inputsForConditions)}<span class="text-severity-alarm">*</span>{/if}
				</label>
				{#if enumVariants(p.kind).length > 0}
					<select
						id="{idPrefix}-{p.name}"
						bind:value={form.values[p.name]}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					>
						{#if !p.required && p.default == null}<option value=""> - </option>{/if}
						{#each enumVariants(p.kind) as variant}
							<option value={variant}>{variant.replace(/_/g, ' ')}</option>
						{/each}
					</select>
				{:else if p.kind === 'string'}
					<input
						id="{idPrefix}-{p.name}"
						type="text"
						bind:value={form.values[p.name]}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					/>
				{:else}
					<input
						id="{idPrefix}-{p.name}"
						type="number"
						step={p.kind === 'integer' ? '1' : 'any'}
						bind:value={form.values[p.name]}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					/>
				{/if}
				{#if advisoryNote(p)}
					<p class="text-xs text-brand-muted">Applies when: {advisoryNote(p)}</p>
				{/if}
			</div>
		{:else if item.type === 'boolean'}
			{@const p = item.param}
			<div class="flex flex-col gap-1">
				<label class="flex items-center gap-2 text-sm font-medium">
					<input type="checkbox" bind:checked={form.bools[p.name]} class="accent-brand-primary" />
					{p.label}
				</label>
				{#if advisoryNote(p)}
					<p class="text-xs text-brand-muted">Applies when: {advisoryNote(p)}</p>
				{/if}
			</div>
		{:else if item.type === 'array'}
			{@const p = item.param}
			<div>
				{@render paramHeading(p.label, p.units, paramRequired(p, inputsForConditions), advisoryNote(p))}
				<div class="mt-1 space-y-1">
					{#each form.arrays[p.name] ?? [] as _, idx}
						<div class="flex items-center gap-1.5">
							<span class="text-xs text-brand-muted font-medium w-5 text-right">{idx + 1}</span>
							<input
								type="number"
								step="any"
								bind:value={form.arrays[p.name][idx]}
								aria-label="{p.label} {idx + 1}"
								class="w-40 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs"
							/>
							{#if (form.arrays[p.name]?.length ?? 0) > 1}
								<button type="button" onclick={() => removeArrayRow(p.name, idx)} aria-label="Remove value" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
							{/if}
						</div>
					{/each}
				</div>
				<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addArrayRow(p.name)}>+ Add value</Button>
			</div>
		{:else if item.type === 'replicates'}
			{@const p = item.param}
			{@const rows = form.arrays[p.name] ?? []}
			{@const filled = rows.filter((v) => v !== '').length}
			<div>
				{@render paramHeading(p.label, p.units, paramRequired(p, inputsForConditions), advisoryNote(p))}
				{#if p.description}<p class="text-xs text-brand-muted">{p.description}</p>{/if}
				<div class="mt-1 space-y-1">
					{#each rows as _, idx}
						<div class="flex items-center gap-1.5">
							<span class="text-xs text-brand-muted font-medium w-20 text-right">Replicate {idx + 1}</span>
							<input
								type="number"
								step="any"
								bind:value={form.arrays[p.name][idx]}
								aria-label="{p.label} replicate {idx + 1}"
								class="w-40 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs"
							/>
							{#if rows.length > 1}
								<button type="button" onclick={() => removeArrayRow(p.name, idx)} aria-label="Remove replicate" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
							{/if}
						</div>
					{/each}
				</div>
				<div class="flex items-center gap-3 mt-1">
					<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => addArrayRow(p.name)}>+ Add replicate</Button>
					<span class="text-xs text-brand-muted">{filled} of {rows.length} entered</span>
				</div>
			</div>
		{:else if item.type === 'struct'}
			{@const p = item.param}
			{@const shape = item.shape}
			<div>
				{@render paramHeading(p.label, p.units, paramRequired(p, inputsForConditions), advisoryNote(p))}
				<div class="overflow-x-auto mt-1">
					<table class="text-xs w-full">
						<thead>
							<tr class="text-left text-brand-muted">
								{#if shape.form !== 'object'}<th class="px-1 py-1"></th>{/if}
								{#if shape.form === 'lists'}
									{#each Array.from({ length: shape.slots }, (_, i) => i) as slot}
										<th class="px-1 py-1 whitespace-nowrap">{shape.slotLabels[slot] ?? `Value ${slot + 1}`}</th>
									{/each}
								{:else}
									{#each shape.fields as field}
										<th class="px-1 py-1 whitespace-nowrap">
											{field.label}{unitSuffix(field.units)}{#if field.required}<span class="text-severity-alarm">*</span>{/if}
										</th>
									{/each}
									{#each shape.entry as column}
										<th class="px-1 py-1 whitespace-nowrap">{column.label}{unitSuffix(column.units)}</th>
									{/each}
									{#each shape.computed as column}
										<th class="px-1 py-1 whitespace-nowrap italic">{column.label}{unitSuffix(column.units)}</th>
									{/each}
								{/if}
								{#if shape.form === 'rows'}<th class="px-1 py-1"></th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each form.structs[p.name] ?? [] as row, idx}
								<tr>
									{#if shape.form === 'lists'}
										<td class="px-1 py-0.5 text-brand-muted font-medium whitespace-nowrap">{shape.fields[idx]?.label ?? ''}</td>
										{#each Array.from({ length: shape.slots }, (_, i) => i) as slot}
											<td class="px-1 py-0.5">
												<input
													type="number"
													step="any"
													bind:value={form.structs[p.name][idx][listCell(slot)]}
													aria-label="{shape.fields[idx]?.label ?? ''} {shape.slotLabels[slot] ?? slot + 1}"
													class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
												/>
											</td>
										{/each}
									{:else}
										{#if shape.form === 'rows'}
											<td class="px-1 py-0.5 text-brand-muted font-medium">{rowLabelFor(shape, idx)}</td>
										{/if}
										{#each shape.fields as field}
											<td class="px-1 py-0.5">
												{#if field.slots}
													<div class="flex gap-1">
														{#each Array.from({ length: field.slots }, (_, i) => i) as slot}
															<input
																type="number"
																step="any"
																bind:value={form.structs[p.name][idx][slotCell(field.name, slot)]}
																aria-label="{p.label} {rowLabelFor(shape, idx)} {field.label} {slot + 1}"
																class="w-14 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
															/>
														{/each}
													</div>
												{:else}
													<input
														type="number"
														step="any"
														bind:value={form.structs[p.name][idx][field.name]}
														aria-label="{p.label} {rowLabelFor(shape, idx)} {field.label}"
														class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
													/>
												{/if}
											</td>
										{/each}
										{#each shape.entry as column}
											<td class="px-1 py-0.5">
												<input
													type="number"
													step="any"
													bind:value={form.structs[p.name][idx][column.name]}
													aria-label="{p.label} {rowLabelFor(shape, idx)} {column.label}"
													class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
												/>
											</td>
										{/each}
										{#each shape.computed as column}
											{@const value = difference(row, column.minuend, column.subtrahend)}
											<td class="px-1 py-0.5 font-mono text-brand-muted">
												{value !== null ? (Number.isInteger(value) ? value : value.toPrecision(5)) : ''}
											</td>
										{/each}
									{/if}
									{#if shape.form === 'rows'}
										<td class="px-1 py-0.5">
											{#if (form.structs[p.name]?.length ?? 0) > 1}
												<button type="button" onclick={() => removeStructRow(p.name, idx)} aria-label="Remove row" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
											{/if}
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="flex items-center gap-2">
					{#if shape.form === 'rows' && (shape.maxRows === null || (form.structs[p.name]?.length ?? 0) < shape.maxRows)}
						<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addStructRow(p.name, shape)}>+ Add row</Button>
					{/if}
					{#if shape.dynamic}
						<input
							type="text"
							bind:value={newColumn[p.name]}
							placeholder="field_name"
							aria-label="{p.label} new field name"
							class="mt-1 w-40 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs"
						/>
						<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addStructColumn(p.name)}>+ Add field</Button>
					{/if}
				</div>
			</div>
		{:else if item.type === 'series'}
			{@const group = item.group}
			<div>
				<span class="text-sm font-medium">{group.title}</span>
				<div class="overflow-x-auto mt-1">
					<table class="text-xs w-full">
						<thead>
							<tr class="text-left text-brand-muted">
								<th class="px-1 py-1"></th>
								{#each item.params as p}
									<th class="px-1 py-1 whitespace-nowrap">
										{p.label}{unitSuffix(p.units)}{#if paramRequired(p, inputsForConditions)}<span class="text-severity-alarm">*</span>{/if}
									</th>
								{/each}
								<th class="px-1 py-1"></th>
							</tr>
						</thead>
						<tbody>
							{#each form.series[group.title] ?? [] as _, idx}
								<tr>
									<td class="px-1 py-0.5 text-brand-muted font-medium">{idx + 1}</td>
									{#each group.params as name}
										<td class="px-1 py-0.5">
											<input
												type="number"
												step="any"
												bind:value={form.series[group.title][idx][name]}
												aria-label="{group.title} {idx + 1} {name}"
												class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
											/>
										</td>
									{/each}
									<td class="px-1 py-0.5">
										{#if (form.series[group.title]?.length ?? 0) > 1}
											<button type="button" onclick={() => removeSeriesRow(group.title, idx)} aria-label="Remove row" class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs">&times;</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Button variant="ghost" size="sm" class="text-brand-primary mt-1" onclick={() => addSeriesRow(group.title, group.params)}>+ Add row</Button>
			</div>
		{:else if item.type === 'matrix'}
			{@const group = item.group}
			<div>
				<span class="text-sm font-medium">{group.title}</span>
				<div class="overflow-x-auto mt-1">
					<table class="text-xs w-full">
						<thead>
							<tr class="text-left text-brand-muted">
								<th class="px-1 py-1"></th>
								{#each group.reps as rep}
									<th class="px-1 py-1 whitespace-nowrap">{rep}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each group.rows as row (row.key)}
								<tr>
									<td class="px-1 py-0.5 text-brand-muted font-medium whitespace-nowrap">
										{row.label}{unitSuffix(row.units)}
									</td>
									{#each row.cells as cell, idx}
										<td class="px-1 py-0.5">
											{#if cell}
												<input
													type="number"
													step="any"
													bind:value={form.values[cell.name]}
													aria-label="{row.label} {group.reps[idx]}"
													class="w-full min-w-16 px-1 py-0.5 border border-brand-divider rounded bg-brand-surface text-xs"
												/>
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/each}

	{#each spec.curves as c (spec.name + c.name)}
		<CurvePicker title={c.label} required={c.required} bind:value={curveSelections[c.name]} />
	{/each}

	{#if plan.length === 0 && spec.curves.length === 0}
		<p class="text-sm text-brand-muted">This manifest declares no params or curve slots yet.</p>
	{/if}
</div>
