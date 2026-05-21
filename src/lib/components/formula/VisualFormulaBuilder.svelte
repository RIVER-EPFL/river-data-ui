<script lang="ts">
	import { type FormulaNode, parseFromMeval, serializeToMeval, replaceAtPath, hasEmptySlots, wrapWithOp } from './ast';
	import { tokens } from '$lib/charts/tokens';

	let {
		value = $bindable(''),
		variables = [],
	}: {
		value: string;
		variables: Array<{ name: string; label: string; category?: string }>;
	} = $props();

	let root = $state<FormulaNode>(value ? parseFromMeval(value) : { type: 'empty' });
	let selectedPath = $state<string | null>(null);
	let paletteSearch = $state('');
	let editingConstantPath = $state<string | null>(null);
	let editingConstantValue = $state('');

	const FUNCTIONS = ['sqrt', 'abs', 'ln', 'log', 'sin', 'cos', 'tan', 'exp', 'floor', 'ceil', 'round', 'min', 'max'];
	const MULTI_ARG_FUNCTIONS = new Set(['min', 'max']);
	const filteredVars = $derived(variables.filter((v) => !paletteSearch || v.label.toLowerCase().includes(paletteSearch.toLowerCase()) || v.name.toLowerCase().includes(paletteSearch.toLowerCase())));
	const filteredFns = $derived(FUNCTIONS.filter((f) => !paletteSearch || f.includes(paletteSearch.toLowerCase())));

	const groupedVars = $derived.by(() => {
		const groups = new Map<string, typeof filteredVars>();
		for (const v of filteredVars) {
			const cat = v.category ?? 'Other';
			if (!groups.has(cat)) groups.set(cat, []);
			groups.get(cat)!.push(v);
		}
		return groups;
	});

	function syncText() {
		value = serializeToMeval(root);
	}

	function insertVariable(name: string) {
		const node: FormulaNode = { type: 'variable', name };
		if (selectedPath) {
			root = replaceAtPath(root, selectedPath, node);
		} else if (root.type === 'empty') {
			root = node;
		} else {
			root = wrapWithOp(root, '*');
			if (root.type === 'binary') root.right = node;
		}
		selectedPath = null;
		syncText();
	}

	function insertConstant(val: number) {
		const node: FormulaNode = { type: 'constant', value: val };
		if (selectedPath) {
			root = replaceAtPath(root, selectedPath, node);
		} else if (root.type === 'empty') {
			root = node;
		}
		selectedPath = null;
		syncText();
	}

	function insertFunction(name: string) {
		const argCount = (name === 'min' || name === 'max') ? 2 : 1;
		const node: FormulaNode = { type: 'function', name, args: Array(argCount).fill({ type: 'empty' }) };
		if (selectedPath) {
			root = replaceAtPath(root, selectedPath, node);
		} else if (root.type === 'empty') {
			root = node;
		}
		selectedPath = null;
		syncText();
	}

	function addOperator(op: string) {
		if (selectedPath) {
			const current = getNodeFromPath(selectedPath);
			if (current && current.type !== 'empty') {
				root = replaceAtPath(root, selectedPath, wrapWithOp(current, op));
				syncText();
				return;
			}
		}
		if (root.type !== 'empty') {
			root = wrapWithOp(root, op);
			syncText();
		}
	}

	function getNodeFromPath(path: string): FormulaNode | null {
		if (path === 'root') return root;
		const parts = path.replace('root.', '').split('.');
		let node: FormulaNode = root;
		for (const part of parts) {
			if (node.type === 'binary') {
				if (part === 'left') node = node.left;
				else if (part === 'right') node = node.right;
				else return null;
			} else if (node.type === 'function') {
				const idx = parseInt(part.replace('args.', ''));
				if (!isNaN(idx) && node.args[idx]) node = node.args[idx];
				else return null;
			} else return null;
		}
		return node;
	}

	function deleteAtPath(path: string) {
		root = replaceAtPath(root, path, { type: 'empty' });
		selectedPath = null;
		syncText();
	}

	function updateConstant(path: string, newValue: number) {
		root = replaceAtPath(root, path, { type: 'constant', value: newValue });
		editingConstantPath = null;
		syncText();
	}

	function addFunctionArg(path: string) {
		const node = getNodeFromPath(path);
		if (node && node.type === 'function') {
			node.args.push({ type: 'empty' });
			root = { ...root };
			syncText();
		}
	}

	function clearAll() {
		root = { type: 'empty' };
		selectedPath = null;
		syncText();
	}

	function handleTextInput(e: Event) {
		const text = (e.target as HTMLInputElement).value;
		value = text;
		try { root = parseFromMeval(text); } catch { /* invalid formula */ }
	}

	function colorForVar(index: number): string {
		return tokens.dataViz[index % tokens.dataViz.length];
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<!-- Text input -->
	<div class="px-4 py-3 border-b border-brand-divider bg-brand-bg">
		<input
			type="text"
			{value}
			oninput={handleTextInput}
			placeholder="Type formula directly or build visually below..."
			class="w-full px-3 py-2 border border-brand-divider rounded bg-brand-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		{#if hasEmptySlots(root) && root.type !== 'empty'}
			<span class="text-xs text-severity-warning mt-1 block">Formula has empty slots (shown as ?)</span>
		{/if}
	</div>

	<div class="flex min-h-[200px]">
		<!-- Palette -->
		<div class="w-56 shrink-0 border-r border-brand-divider bg-brand-bg p-3 space-y-3 overflow-y-auto max-h-[400px]">
			<input
				type="text"
				placeholder="Search variables..."
				bind:value={paletteSearch}
				class="w-full px-2 py-1.5 border border-brand-divider rounded text-xs bg-brand-surface focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
			/>

			<!-- Variables grouped by category -->
			{#each [...groupedVars.entries()] as [category, vars]}
				<div>
					<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">{category}</div>
					<div class="space-y-1">
						{#each vars as v}
							{@const vi = variables.indexOf(v)}
							<button
								onclick={() => insertVariable(v.name)}
								class="w-full text-left px-2 py-1.5 rounded cursor-pointer border-none text-xs hover:ring-1 hover:ring-brand-primary/50 flex items-center gap-2 group"
								style:background="{colorForVar(vi)}18"
								title="Click to insert {v.name}"
							>
								<span class="w-2 h-2 rounded-full shrink-0" style:background={colorForVar(vi)}></span>
								<span class="flex-1 min-w-0">
									<span class="block font-medium text-brand-text truncate">{v.label}</span>
									<span class="block font-mono text-brand-muted text-[10px] truncate">{v.name}</span>
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}

			<!-- Operators -->
			<div>
				<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">Operators</div>
				<div class="flex gap-1">
					{#each ['+', '-', '*', '/', '^'] as op}
						<button
							onclick={() => addOperator(op)}
							class="w-8 h-8 text-sm font-mono rounded cursor-pointer border border-brand-divider bg-brand-surface hover:bg-brand-bg flex items-center justify-center font-bold"
						>{op}</button>
					{/each}
				</div>
			</div>

			<!-- Functions -->
			{#if filteredFns.length > 0}
				<div>
					<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">Functions</div>
					<div class="flex flex-wrap gap-1">
						{#each filteredFns as fn}
							<button
								onclick={() => insertFunction(fn)}
								class="px-2 py-1 text-xs rounded cursor-pointer border border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg"
							>{fn}()</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Constants -->
			<div>
				<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">Constants</div>
				<div class="flex flex-wrap gap-1">
					{#each [0, 1, -1, 2, 0.001, 0.032, 273.15] as c}
						<button
							onclick={() => insertConstant(c)}
							class="px-2 py-1 text-xs font-mono rounded cursor-pointer border border-brand-divider bg-brand-surface hover:bg-brand-bg"
						>{c}</button>
					{/each}
				</div>
			</div>

			<button onclick={clearAll} class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Clear formula</button>
		</div>

		<!-- Visual tree -->
		<div class="flex-1 p-4 overflow-auto flex items-start">
			{#if root.type === 'empty'}
				<div
					class="w-full border-2 border-dashed border-brand-divider rounded-md p-8 text-center text-sm text-brand-muted cursor-pointer hover:border-brand-primary transition-colors"
					role="button"
					tabindex="0"
					onclick={() => selectedPath = 'root'}
					onkeydown={(e) => e.key === 'Enter' && (selectedPath = 'root')}
				>
					Click a variable from the palette to start building your formula
				</div>
			{:else}
				<div class="text-sm leading-relaxed">
					{@render nodeView(root, 'root')}
				</div>
			{/if}
		</div>
	</div>
</div>

{#snippet nodeView(node: FormulaNode, path: string)}
	{#if node.type === 'variable'}
		{@const vi = variables.findIndex((v) => v.name === node.name)}
		{@const label = variables.find((v) => v.name === node.name)?.label ?? node.name}
		<span
			class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-white cursor-pointer transition-shadow {selectedPath === path ? 'ring-2 ring-brand-accent shadow-md' : 'hover:shadow-sm'}"
			style:background={colorForVar(vi >= 0 ? vi : 7)}
			role="button" tabindex="0"
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
			title="{label} ({node.name})"
		>
			{label}
			<button onclick={(e) => { e.stopPropagation(); deleteAtPath(path); }} class="text-white/60 hover:text-white bg-transparent border-none cursor-pointer text-xs ml-0.5">&times;</button>
		</span>
	{:else if node.type === 'constant'}
		{#if editingConstantPath === path}
			<input
				type="number"
				step="any"
				value={node.value}
				class="w-20 px-1.5 py-0.5 text-xs font-mono border border-brand-primary rounded bg-brand-surface focus:outline-none focus:ring-1 focus:ring-brand-primary"
				autofocus
				onblur={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (!isNaN(v)) updateConstant(path, v); else editingConstantPath = null; }}
				onkeydown={(e) => { if (e.key === 'Enter') { const v = parseFloat((e.target as HTMLInputElement).value); if (!isNaN(v)) updateConstant(path, v); } if (e.key === 'Escape') editingConstantPath = null; }}
			/>
		{:else}
			<span
				class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-brand-surface border border-brand-divider cursor-pointer transition-shadow {selectedPath === path ? 'ring-2 ring-brand-accent shadow-md' : 'hover:shadow-sm'}"
				role="button" tabindex="0"
				onclick={() => selectedPath = path}
				ondblclick={() => { editingConstantPath = path; editingConstantValue = String(node.value); }}
				onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
				title="Double-click to edit value"
			>
				{node.value}
				<button onclick={(e) => { e.stopPropagation(); deleteAtPath(path); }} class="text-brand-muted hover:text-brand-text bg-transparent border-none cursor-pointer text-xs">&times;</button>
			</span>
		{/if}
	{:else if node.type === 'binary'}
		<span class="inline-flex items-center gap-1.5 flex-wrap">
			{@render nodeView(node.left, `${path}.left`)}
			<span class="font-mono text-base font-bold text-brand-primary">{node.op}</span>
			{@render nodeView(node.right, `${path}.right`)}
		</span>
	{:else if node.type === 'function'}
		<span class="inline-flex items-center gap-0.5 flex-wrap">
			<span class="text-xs font-bold text-brand-primary">{node.name}(</span>
			{#each node.args as arg, i}
				{#if i > 0}<span class="text-xs text-brand-muted">,&nbsp;</span>{/if}
				{@render nodeView(arg, `${path}.args.${i}`)}
			{/each}
			{#if MULTI_ARG_FUNCTIONS.has(node.name)}
				<button
					onclick={(e) => { e.stopPropagation(); addFunctionArg(path); }}
					class="w-4 h-4 text-xs rounded-full bg-brand-bg border border-brand-divider text-brand-muted cursor-pointer hover:text-brand-primary hover:border-brand-primary flex items-center justify-center ml-0.5"
					title="Add argument"
				>+</button>
			{/if}
			<span class="text-xs font-bold text-brand-primary">)</span>
		</span>
	{:else}
		<span
			class="inline-block px-3 py-1 border-2 border-dashed border-brand-divider rounded-md text-xs text-brand-muted cursor-pointer hover:border-brand-primary transition-colors {selectedPath === path ? 'border-brand-accent bg-brand-accent/10' : ''}"
			role="button" tabindex="0"
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
		>?</span>
	{/if}
{/snippet}
