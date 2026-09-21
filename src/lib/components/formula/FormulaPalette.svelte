<script lang="ts">
	import type { DragPayload } from './ast';
	import { tokens } from '$lib/charts/tokens';
	import { FORMULA_FUNCTIONS, FORMULA_FUNCTION_HELP } from '$lib/formula/lint';
	import type { Constant } from '$api/crud';
	import Button from '$components/ui/Button.svelte';

	// Everything a formula can name, in one column: the catalog's variables by category, the
	// engine's functions, the operators and the constants. Each entry is picked by click or key
	// and carries the same payload when dragged, so a drop target elsewhere reads it the same way.

	let {
		variables = [],
		constants = [],
		onpick,
		onclear,
		ondrag,
		class: className = '',
	}: {
		variables: Array<{ name: string; label: string; category?: string }>;
		constants?: Constant[];
		onpick: (payload: DragPayload) => void;
		/** Offered only where there is something to clear. */
		onclear?: () => void;
		/** What has just been picked up, for a drop target that cannot read the transfer early. */
		ondrag?: (payload: DragPayload) => void;
		class?: string;
	} = $props();

	const OPERATORS = ['+', '-', '*', '/', '^'] as const;
	const FUNCTIONS = Object.keys(FORMULA_FUNCTIONS);

	let search = $state('');
	let closedSections = $state<Record<string, boolean>>({ Functions: true, Constants: true });

	const constantNames = $derived(new Set(constants.map((c) => c.name)));
	const filteredVars = $derived(
		variables.filter((v) => {
			if (constantNames.has(v.name)) return false;
			if (!search) return true;
			const q = search.toLowerCase();
			return v.label.toLowerCase().includes(q) || v.name.toLowerCase().includes(q);
		}),
	);
	const filteredFns = $derived(FUNCTIONS.filter((f) => !search || f.includes(search.toLowerCase())));
	const filteredConstants = $derived(
		constants.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase())),
	);
	const groupedVars = $derived.by(() => {
		const groups = new Map<string, typeof filteredVars>();
		for (const v of filteredVars) {
			const category = v.category ?? 'Other';
			if (!groups.has(category)) groups.set(category, []);
			groups.get(category)!.push(v);
		}
		return groups;
	});

	function toggleSection(name: string) {
		closedSections = { ...closedSections, [name]: !closedSections[name] };
	}

	function sectionOpen(name: string, matches: number): boolean {
		if (search) return matches > 0;
		return !closedSections[name];
	}

	function onDragStart(e: DragEvent, payload: DragPayload) {
		ondrag?.(payload);
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copy';
		e.dataTransfer.setData('text/plain', JSON.stringify(payload));
	}

	function keydown(e: KeyboardEvent, payload: DragPayload) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onpick(payload);
		}
	}

	function hashCode(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
		return h;
	}

	function colorForVar(name: string): string {
		const idx = variables.findIndex((v) => v.name === name);
		const i = idx >= 0 ? idx : Math.abs(hashCode(name)) % tokens.dataViz.length;
		return tokens.dataViz[i % tokens.dataViz.length];
	}

	function fmtNumber(v: number): string {
		if (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)) return v.toExponential(2);
		return String(v);
	}
</script>

{#snippet sectionHeader(name: string, count: number)}
	<button
		type="button"
		onclick={() => toggleSection(name)}
		aria-expanded={sectionOpen(name, count)}
		class="w-full flex items-center gap-1 py-0.5 text-xs font-semibold text-brand-muted uppercase tracking-wider bg-transparent border-none cursor-pointer hover:text-brand-text"
	>
		<span class="font-mono text-[10px]">{sectionOpen(name, count) ? '▾' : '▸'}</span>
		<span class="truncate">{name}</span>
		<span class="ml-auto font-normal normal-case tabular-nums">{count}</span>
	</button>
{/snippet}

<div class="space-y-2 {className}">
	<input
		type="text"
		placeholder="Search…"
		aria-label="Search the palette"
		bind:value={search}
		class="w-full px-2 py-1.5 border border-brand-divider rounded text-xs bg-brand-surface focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
	/>

	{#each [...groupedVars.entries()] as [category, vars] (category)}
		<div>
			{@render sectionHeader(category, vars.length)}
			{#if sectionOpen(category, vars.length)}
				<div>
					{#each vars as v (v.name)}
						<div
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={(e) => onDragStart(e, { kind: 'variable', name: v.name })}
							onclick={() => onpick({ kind: 'variable', name: v.name })}
							onkeydown={(e) => keydown(e, { kind: 'variable', name: v.name })}
							class="px-1.5 py-0.5 rounded text-xs cursor-grab active:cursor-grabbing border border-transparent hover:border-brand-primary/40 flex items-center gap-1.5"
							title="{v.label}&#10;Click or drag into formula"
						>
							<span class="w-1.5 h-1.5 rounded-full shrink-0" style:background={colorForVar(v.name)}></span>
							<span class="font-mono text-brand-text truncate">{v.name}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	{#if filteredFns.length > 0}
		<div>
			{@render sectionHeader('Functions', filteredFns.length)}
			{#if sectionOpen('Functions', filteredFns.length)}
				<div class="flex flex-wrap gap-1">
					{#each filteredFns as fn (fn)}
						<div
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={(e) => onDragStart(e, { kind: 'function', name: fn })}
							onclick={() => onpick({ kind: 'function', name: fn })}
							onkeydown={(e) => keydown(e, { kind: 'function', name: fn })}
							class="px-1.5 py-0.5 text-xs rounded cursor-grab active:cursor-grabbing border border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg"
							title="{FORMULA_FUNCTION_HELP[fn] ?? fn}&#10;Click or drag {fn}() into formula; drop onto a token to wrap it"
						>{fn}()</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div>
		{@render sectionHeader('Operators', OPERATORS.length)}
		{#if sectionOpen('Operators', OPERATORS.length)}
			<div class="flex gap-1 flex-wrap">
				{#each OPERATORS as op (op)}
					<div
						draggable="true"
						role="button"
						tabindex="0"
						ondragstart={(e) => onDragStart(e, { kind: 'operator', op })}
						onclick={() => onpick({ kind: 'operator', op })}
						onkeydown={(e) => keydown(e, { kind: 'operator', op })}
						class="w-7 h-7 text-sm font-mono rounded cursor-grab active:cursor-grabbing border border-brand-divider bg-brand-surface hover:bg-brand-bg flex items-center justify-center font-bold"
						aria-label="Insert {op} operator"
					>{op}</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if filteredConstants.length > 0}
		<div>
			{@render sectionHeader('Constants', filteredConstants.length)}
			{#if sectionOpen('Constants', filteredConstants.length)}
				<div>
					{#each filteredConstants as c (c.name)}
						<div
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={(e) => onDragStart(e, { kind: 'constant', name: c.name })}
							onclick={() => onpick({ kind: 'constant', name: c.name })}
							onkeydown={(e) => keydown(e, { kind: 'constant', name: c.name })}
							class="px-1.5 py-0.5 rounded cursor-grab active:cursor-grabbing border border-transparent hover:border-brand-primary/40 flex items-baseline justify-between gap-2"
							title="{c.description || c.name}&#10;{fmtNumber(c.value)}{c.units ? ` ${c.units}` : ''}"
						>
							<span class="font-mono text-xs text-brand-text truncate">{c.name}</span>
							<span class="font-mono text-numeric text-brand-muted whitespace-nowrap">
								{fmtNumber(c.value)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if onclear}
		<Button variant="ghost" size="sm" class="text-severity-alarm" onclick={onclear}>Clear formula</Button>
	{/if}
</div>
