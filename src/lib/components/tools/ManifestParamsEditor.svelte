<script lang="ts">
	import { untrack } from 'svelte';
	import { isToolParamCondition, type ToolParam } from '$api/service';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import { markClass, paramField, type Severity } from '$lib/tools/validation';
	import {
		insertionIndex,
		nextLetter,
		repLabel,
		repName,
		replicateFamilies,
		splitRepName,
		type ReplicateFamily,
		type VaryingField,
	} from '$lib/tools/replicates';
	import {
		ENUM_PREFIX,
		PARAM_KINDS,
		blankParam,
		enumVariants,
		formatDefault,
		kindBase,
		makeEnumKind,
		parseDefault,
	} from './manifest';

	let {
		params = $bindable(),
		defaultErrors = $bindable([]),
		marks = {},
		onTouch,
	}: {
		params: ToolParam[];
		/** Per row: why the default text does not parse for its kind, empty when it does. */
		defaultErrors?: string[];
		marks?: Record<string, Severity>;
		onTouch: (target: string) => void;
	} = $props();

	const field = 'w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs';

	// Defaults and enum variants are edited as text and only reach the manifest once they parse, so
	// each row keeps its own buffer. Seeded once: the parent remounts this editor when it loads a
	// different version, which is the only time the buffers go stale.
	let defaultText = $state(params.map((p) => formatDefault(p.default)));
	let variantText = $state(params.map((p) => enumVariants(p.kind).join('|')));
	// The fields an author sets on some rows only (units, default, when) are folded per row.
	let expanded = $state(params.map(() => false));

	// The grouped view is a view over the same flat params: nothing here changes what is saved
	// unless the author edits, so it starts on wherever there is a family to show.
	let grouped = $state(replicateFamilies(params).families.length > 0);
	let openFamilies = $state<Record<string, boolean>>({});

	// The detection panel appends rows to the same array from outside this component, so the
	// buffers follow its length. Only appends arrive that way; removals and reordering happen here.
	$effect(() => {
		const n = params.length;
		untrack(() => {
			if (defaultText.length === n) return;
			defaultText = params.map((p, i) => defaultText[i] ?? formatDefault(p.default));
			defaultErrors = params.map((_, i) => defaultErrors[i] ?? '');
			variantText = params.map((p, i) => variantText[i] ?? enumVariants(p.kind).join('|'));
			expanded = params.map((_, i) => expanded[i] ?? false);
		});
	});

	const detected = $derived(replicateFamilies(params));
	const view = $derived(
		grouped ? detected : { families: [], letters: [], memberIndices: new Set<number>() },
	);
	const memberCount = $derived(view.families.reduce((n, f) => n + f.members.length, 0));

	type Row = { type: 'param'; index: number } | { type: 'family'; family: ReplicateFamily };

	// A family renders where its first member is declared, so a param that is not in one keeps its
	// own position and the table reads in manifest order either way.
	const rows = $derived.by<Row[]>(() => {
		const at = new Map(view.families.map((f) => [f.firstIndex, f]));
		const out: Row[] = [];
		params.forEach((_, index) => {
			const family = at.get(index);
			if (family) out.push({ type: 'family', family });
			else if (!view.memberIndices.has(index)) out.push({ type: 'param', index });
		});
		return out;
	});

	const famField = (base: string, name: string) => `tm-fam-${base}-${name}`;

	function memberMark(f: ReplicateFamily, name: string): Severity | undefined {
		let worst: Severity | undefined;
		for (const m of f.members) {
			const mark = marks[paramField(m.index, name)];
			if (mark === 'blocking') return 'blocking';
			if (mark) worst = mark;
		}
		return worst;
	}

	// A marked member has to be reachable, so a family holding one opens whether or not it was
	// unfolded by hand.
	const isOpen = (f: ReplicateFamily) =>
		openFamilies[f.base] === true ||
		['name', 'label', 'kind', 'variants', 'default'].some((n) => memberMark(f, n) !== undefined);

	function onDefaultInput(i: number) {
		const { value, error } = parseDefault(defaultText[i], params[i].kind);
		const next = params.map((_, j) => defaultErrors[j] ?? '');
		next[i] = error;
		defaultErrors = next;
		if (!error) params[i].default = value;
	}

	function onKindChange(i: number, base: string) {
		params[i].kind = base === 'enum' ? makeEnumKind(variantText[i]) : base;
		onDefaultInput(i);
	}

	function onVariantsInput(i: number) {
		params[i].kind = makeEnumKind(variantText[i]);
		onDefaultInput(i);
	}

	function addRow() {
		params = [...params, blankParam()];
		defaultText = [...defaultText, ''];
		defaultErrors = [...defaultErrors, ''];
		variantText = [...variantText, ''];
		expanded = [...expanded, false];
	}

	function removeIndices(drop: Set<number>) {
		const keep = params.map((_, i) => i).filter((i) => !drop.has(i));
		applyOrder(keep);
	}

	function removeRow(i: number) {
		removeIndices(new Set([i]));
	}

	/** Every parallel buffer follows the same permutation, so a row never loses its own text. */
	function applyOrder(order: number[]) {
		params = order.map((i) => params[i]);
		defaultText = order.map((i) => defaultText[i]);
		defaultErrors = order.map((i) => defaultErrors[i] ?? '');
		variantText = order.map((i) => variantText[i]);
		expanded = order.map((i) => expanded[i] ?? false);
	}

	/** Move a whole block one row up or down, past whatever the neighbouring row covers. */
	function moveBlock(block: number[], rowPos: number, dir: -1 | 1) {
		const neighbour = rows[rowPos + dir];
		if (!neighbour) return;
		const anchor =
			neighbour.type === 'param'
				? [neighbour.index]
				: neighbour.family.members.map((m) => m.index).sort((a, b) => a - b);
		const moving = new Set(block);
		const rest = params.map((_, i) => i).filter((i) => !moving.has(i));
		const cut =
			dir === -1 ? rest.indexOf(anchor[0]) : rest.indexOf(anchor[anchor.length - 1]) + 1;
		applyOrder([...rest.slice(0, cut), ...block.sort((a, b) => a - b), ...rest.slice(cut)]);
	}

	function insertParam(at: number, param: ToolParam, text: string) {
		const splice = <T,>(list: T[], item: T) => {
			const next = [...list];
			next.splice(at, 0, item);
			return next;
		};
		params = splice(params, param);
		defaultText = splice(defaultText, text);
		defaultErrors = splice(defaultErrors, '');
		variantText = splice(variantText, enumVariants(param.kind).join('|'));
		expanded = splice(expanded, false);
	}

	/** A new member of `family`, cloned from its first member so the family stays one measurement. */
	function addMember(family: ReplicateFamily, letter: string) {
		const first = family.members[0].param;
		insertParam(
			insertionIndex(params, family.base, letter),
			{
				...first,
				name: repName(family.base, letter),
				label: repLabel(family.label, letter, first.label),
			},
			formatDefault(first.default),
		);
	}

	function addReplicate() {
		const letter = nextLetter(view.letters);
		// Families are re-derived after every insert, so each one is placed against current indices.
		for (const base of view.families.map((f) => f.base)) {
			const family = replicateFamilies(params).families.find((f) => f.base === base);
			if (family && !family.byLetter.has(letter)) addMember(family, letter);
		}
	}

	function removeReplicate(letter: string) {
		const drop = new Set<number>();
		for (const f of view.families) {
			const member = f.byLetter.get(letter);
			if (member) drop.add(member.index);
		}
		if (drop.size === 0) return;
		if (!confirm(`Remove replicate ${letter} from ${drop.size} params?`)) return;
		removeIndices(drop);
	}

	function eachMember(f: ReplicateFamily, run: (index: number) => void) {
		for (const m of f.members) run(m.index);
	}

	function setBase(f: ReplicateFamily, base: string) {
		eachMember(f, (i) => {
			const split = splitRepName(params[i].name);
			if (split) params[i].name = repName(base, split.letter);
		});
	}

	function setLabel(f: ReplicateFamily, stem: string) {
		eachMember(f, (i) => {
			const split = splitRepName(params[i].name);
			if (split) params[i].label = repLabel(stem, split.letter, params[i].label);
		});
	}

	function setFamilyKind(f: ReplicateFamily, kind: string) {
		eachMember(f, (i) => {
			params[i].kind = kind;
			onDefaultInput(i);
		});
	}

	function setUnits(f: ReplicateFamily, units: string) {
		eachMember(f, (i) => (params[i].units = units.trim() || null));
	}

	function setRequired(f: ReplicateFamily, required: boolean) {
		eachMember(f, (i) => (params[i].required = required));
	}

	function setFamilyDefault(f: ReplicateFamily, text: string) {
		eachMember(f, (i) => {
			defaultText[i] = text;
			onDefaultInput(i);
		});
	}

	function touchFamily(f: ReplicateFamily, name: string) {
		eachMember(f, (i) => onTouch(paramField(i, name)));
	}

	const varies = (f: ReplicateFamily, name: VaryingField) => f.varies.has(name);
	const familyDefaultError = (f: ReplicateFamily) =>
		f.members.some((m) => defaultErrors[m.index]);

	/** What a collapsed row is carrying, so nothing set is hidden without a mark. */
	function extrasSet(p: ToolParam, i: number): string[] {
		const set: string[] = [];
		if (p.units) set.push('units');
		if (defaultText[i]?.trim()) set.push('default');
		if (p.when !== null) set.push('when');
		return set;
	}

	function whenLabel(when: ToolParam['when']): string {
		if (when === null) return '';
		if (isToolParamCondition(when)) {
			const value = when.equals !== undefined ? String(when.equals) : (when.any_of ?? []).join(', ');
			return `if ${when.param} = ${value}`;
		}
		return when;
	}
</script>

{#snippet moveButtons(rowPos: number, block: number[])}
	<Button
		size="sm"
		variant="ghost"
		title="Move up"
		disabled={rowPos === 0}
		onclick={() => moveBlock(block, rowPos, -1)}>↑</Button
	>
	<Button
		size="sm"
		variant="ghost"
		title="Move down"
		disabled={rowPos === rows.length - 1}
		onclick={() => moveBlock(block, rowPos, 1)}>↓</Button
	>
{/snippet}

{#snippet paramRow(i: number, rowPos: number, nested: boolean)}
	{@const p = params[i]}
	{@const extras = extrasSet(p, i)}
	<tr
		class="border-brand-divider align-top {expanded[i] ? '' : 'border-b last:border-b-0'} {nested
			? 'bg-brand-bg/30'
			: ''}"
	>
		<td class="px-2 py-1.5 min-w-32 {nested ? 'pl-6' : ''}">
			<input
				id={paramField(i, 'name')}
				type="text"
				aria-label="Param name"
				bind:value={params[i].name}
				onblur={() => onTouch(paramField(i, 'name'))}
				class="{field} font-mono {markClass(marks[paramField(i, 'name')])}"
			/>
		</td>
		<td class="px-2 py-1.5 min-w-36">
			<input
				id={paramField(i, 'label')}
				type="text"
				aria-label="Param label"
				bind:value={params[i].label}
				onblur={() => onTouch(paramField(i, 'label'))}
				class="{field} {markClass(marks[paramField(i, 'label')])}"
			/>
		</td>
		<td class="px-2 py-1.5 min-w-28">
			<select
				id={paramField(i, 'kind')}
				aria-label="Param kind"
				value={kindBase(p.kind)}
				onchange={(e) => onKindChange(i, e.currentTarget.value)}
				onblur={() => onTouch(paramField(i, 'kind'))}
				class="{field} {markClass(marks[paramField(i, 'kind')])}"
			>
				{#each PARAM_KINDS as k}
					<option value={k}>{k}</option>
				{/each}
				<option value="enum">enum</option>
			</select>
			{#if p.kind.startsWith(ENUM_PREFIX) || kindBase(p.kind) === 'enum'}
				<input
					id={paramField(i, 'variants')}
					type="text"
					aria-label="Enum variants, separated by a pipe"
					placeholder="acid|no_acid"
					bind:value={variantText[i]}
					oninput={() => onVariantsInput(i)}
					onblur={() => onTouch(paramField(i, 'variants'))}
					class="{field} font-mono mt-1 {markClass(marks[paramField(i, 'variants')])}"
				/>
			{/if}
		</td>
		<td class="px-2 py-1.5 text-center">
			<input type="checkbox" aria-label="Param required" bind:checked={params[i].required} />
		</td>
		{#if grouped}
			<td class="px-2 py-1.5"></td>
		{/if}
		<td class="px-2 py-1.5 whitespace-nowrap">
			<Button
				size="sm"
				variant="ghost"
				aria-expanded={expanded[i]}
				onclick={() => (expanded[i] = !expanded[i])}>{expanded[i] ? 'Less' : 'More'}</Button
			>
			{#if !expanded[i] && extras.length > 0}
				<Badge variant="accent">{extras.join(', ')}</Badge>
			{/if}
			{#if !expanded[i] && defaultErrors[i]}
				<Badge variant="alarm">default</Badge>
			{/if}
		</td>
		<td class="px-2 py-1.5 whitespace-nowrap text-right">
			{#if !nested}
				{@render moveButtons(rowPos, [i])}
			{/if}
			<Button size="sm" variant="ghost" title="Remove param" onclick={() => removeRow(i)}
				>&times;</Button
			>
		</td>
	</tr>
	{#if expanded[i]}
		<tr class="border-b border-brand-divider last:border-b-0 bg-brand-bg/40">
			<td colspan={grouped ? 7 : 6} class="px-2 py-2">
				<div class="flex flex-wrap items-start gap-3">
					<div class="flex flex-col gap-1 w-32">
						<label for={paramField(i, 'units')} class="font-medium">Units</label>
						<input
							id={paramField(i, 'units')}
							type="text"
							value={params[i].units ?? ''}
							oninput={(e) => (params[i].units = e.currentTarget.value.trim() || null)}
							class={field}
						/>
					</div>
					<div class="flex flex-col gap-1 w-40">
						<label for={paramField(i, 'default')} class="font-medium">Default</label>
						<input
							id={paramField(i, 'default')}
							type="text"
							bind:value={defaultText[i]}
							oninput={() => onDefaultInput(i)}
							onblur={() => onTouch(paramField(i, 'default'))}
							class="{field} font-mono {defaultErrors[i]
								? 'border-severity-alarm-border bg-severity-alarm-soft'
								: ''}"
						/>
					</div>
					<div class="flex flex-col gap-1">
						<span class="font-medium">Conditional</span>
						{#if params[i].when !== null}
							<Badge variant="muted">{whenLabel(params[i].when)}</Badge>
						{:else}
							<span class="text-brand-muted">Always shown</span>
						{/if}
					</div>
				</div>
			</td>
		</tr>
	{/if}
{/snippet}

{#snippet familyRow(f: ReplicateFamily, rowPos: number)}
	{@const open = isOpen(f)}
	{@const block = f.members.map((m) => m.index)}
	<tr class="border-brand-divider align-top {open ? '' : 'border-b last:border-b-0'}">
		<td class="px-2 py-1.5 min-w-32">
			<div class="flex items-center gap-1">
				<input
					id={famField(f.base, 'name')}
					type="text"
					aria-label="Replicate family base name"
					value={f.base}
					oninput={(e) => setBase(f, e.currentTarget.value)}
					onblur={() => touchFamily(f, 'name')}
					class="{field} font-mono {markClass(memberMark(f, 'name'))}"
				/>
				<span class="font-mono text-brand-muted whitespace-nowrap">_rep_*</span>
			</div>
		</td>
		<td class="px-2 py-1.5 min-w-36">
			{#if varies(f, 'label')}
				<Badge variant="muted">varies</Badge>
			{:else}
				<input
					id={famField(f.base, 'label')}
					type="text"
					aria-label="Replicate family label"
					value={f.label}
					oninput={(e) => setLabel(f, e.currentTarget.value)}
					onblur={() => touchFamily(f, 'label')}
					class="{field} {markClass(memberMark(f, 'label'))}"
				/>
			{/if}
		</td>
		<td class="px-2 py-1.5 min-w-28">
			{#if varies(f, 'kind')}
				<Badge variant="muted">varies</Badge>
			{:else}
				<select
					id={famField(f.base, 'kind')}
					aria-label="Replicate family kind"
					value={f.kind}
					onchange={(e) => setFamilyKind(f, e.currentTarget.value)}
					onblur={() => touchFamily(f, 'kind')}
					class="{field} {markClass(memberMark(f, 'kind'))}"
				>
					{#each PARAM_KINDS as k}
						<option value={k}>{k}</option>
					{/each}
				</select>
			{/if}
		</td>
		<td class="px-2 py-1.5 text-center">
			{#if varies(f, 'required')}
				<Badge variant="muted">varies</Badge>
			{:else}
				<input
					type="checkbox"
					aria-label="Replicate family required"
					checked={f.required}
					onchange={(e) => setRequired(f, e.currentTarget.checked)}
				/>
			{/if}
		</td>
		<td class="px-2 py-1.5">
			<div class="flex flex-wrap gap-1">
				{#each view.letters as letter}
					{#if f.byLetter.has(letter)}
						<span
							class="inline-flex items-center gap-0.5 rounded-md border border-brand-divider px-1 font-mono"
						>
							{letter}
							<button
								type="button"
								title="Remove {repName(f.base, letter)}"
								aria-label="Remove {repName(f.base, letter)}"
								class="text-brand-muted hover:text-severity-alarm-main"
								onclick={() => removeRow(f.byLetter.get(letter)?.index ?? -1)}>&times;</button
							>
						</span>
					{:else}
						<button
							type="button"
							title="Add {repName(f.base, letter)}"
							aria-label="Add {repName(f.base, letter)}"
							class="rounded-md border border-dashed border-brand-divider px-1 font-mono text-brand-muted"
							onclick={() => addMember(f, letter)}>{letter}+</button
						>
					{/if}
				{/each}
			</div>
		</td>
		<td class="px-2 py-1.5 whitespace-nowrap">
			<Button
				size="sm"
				variant="ghost"
				aria-expanded={open}
				onclick={() => (openFamilies = { ...openFamilies, [f.base]: !open })}
				>{open ? 'Hide members' : 'Show members'}</Button
			>
			{#if familyDefaultError(f)}
				<Badge variant="alarm">default</Badge>
			{/if}
		</td>
		<td class="px-2 py-1.5 whitespace-nowrap text-right">
			{@render moveButtons(rowPos, block)}
			<Button
				size="sm"
				variant="ghost"
				title="Remove every replicate of {f.base}"
				onclick={() => {
					if (confirm(`Remove ${f.members.length} params of ${f.base}?`)) removeIndices(new Set(block));
				}}>&times;</Button
			>
		</td>
	</tr>
	{#if open}
	<tr class="border-b border-brand-divider last:border-b-0 bg-brand-bg/40">
		<td colspan="7" class="px-2 py-2">
			<div class="flex flex-wrap items-start gap-3">
				<div class="flex flex-col gap-1 w-32">
					<span class="font-medium">Units</span>
					{#if varies(f, 'units')}
						<Badge variant="muted">varies</Badge>
					{:else}
						<input
							id={famField(f.base, 'units')}
							type="text"
							aria-label="Replicate family units"
							value={f.units ?? ''}
							oninput={(e) => setUnits(f, e.currentTarget.value)}
							class={field}
						/>
					{/if}
				</div>
				<div class="flex flex-col gap-1 w-40">
					<span class="font-medium">Default</span>
					{#if varies(f, 'default')}
						<Badge variant="muted">varies</Badge>
					{:else}
						<input
							id={famField(f.base, 'default')}
							type="text"
							aria-label="Replicate family default"
							value={defaultText[f.firstIndex] ?? ''}
							oninput={(e) => setFamilyDefault(f, e.currentTarget.value)}
							onblur={() => touchFamily(f, 'default')}
							class="{field} font-mono {familyDefaultError(f)
								? 'border-severity-alarm-border bg-severity-alarm-soft'
								: ''}"
						/>
					{/if}
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-medium">Conditional</span>
					{#if varies(f, 'when')}
						<Badge variant="muted">varies</Badge>
					{:else if f.members[0].param.when !== null}
						<Badge variant="muted">{whenLabel(f.members[0].param.when)}</Badge>
					{:else}
						<span class="text-brand-muted">Always shown</span>
					{/if}
				</div>
			</div>
		</td>
	</tr>
	{/if}
	{#if open}
		{#each f.members as m}
			{@render paramRow(m.index, rowPos, true)}
		{/each}
	{/if}
{/snippet}

{#if detected.families.length > 0}
	<div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-brand-divider text-xs">
		<label class="flex items-center gap-1">
			<input type="checkbox" bind:checked={grouped} />
			Group replicates
		</label>
		{#if grouped && view.families.length > 0}
			<span class="text-brand-muted">
				{view.families.length}
				{view.families.length === 1 ? 'measurement' : 'measurements'} × {view.letters.length}
				{view.letters.length === 1 ? 'replicate' : 'replicates'} ({memberCount} params)
			</span>
			<span class="grow"></span>
			{#each view.letters as letter}
				<span
					class="inline-flex items-center gap-0.5 rounded-md border border-brand-divider px-1 font-mono"
				>
					{letter}
					<button
						type="button"
						title="Remove replicate {letter} from every measurement"
						aria-label="Remove replicate {letter} from every measurement"
						class="text-brand-muted hover:text-severity-alarm-main"
						onclick={() => removeReplicate(letter)}>&times;</button
					>
				</span>
			{/each}
			<Button size="sm" onclick={addReplicate}>Add replicate</Button>
		{/if}
	</div>
{/if}

{#if params.length === 0}
	<p class="px-3 py-3 text-sm text-brand-muted">None declared.</p>
{:else}
	<div class="overflow-x-auto">
		<table class="w-full text-xs">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider text-left">
					<th class="px-2 py-1.5 font-semibold">Name</th>
					<th class="px-2 py-1.5 font-semibold">Label</th>
					<th class="px-2 py-1.5 font-semibold">Kind</th>
					<th class="px-2 py-1.5 font-semibold" title="Refused when the caller omits it">Req</th>
					{#if grouped}
						<th class="px-2 py-1.5 font-semibold">Replicates</th>
					{/if}
					<th class="px-2 py-1.5 font-semibold">More</th>
					<th class="px-2 py-1.5"></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, rowPos}
					{#if row.type === 'family'}
						{@render familyRow(row.family, rowPos)}
					{:else}
						{@render paramRow(row.index, rowPos, false)}
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<div class="px-3 py-2 border-t border-brand-divider">
	<Button size="sm" onclick={addRow}>Add param</Button>
</div>
