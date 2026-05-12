<script lang="ts">
	import { type FormulaNode, parseFromMeval, serializeToMeval, replaceAtPath, hasEmptySlots, wrapWithOp } from './ast';
	import { tokens } from '$lib/charts/tokens';

	let {
		value = $bindable(''),
		variables = [],
	}: {
		value: string;
		variables: Array<{ name: string; label: string }>;
	} = $props();

	let root = $state<FormulaNode>(value ? parseFromMeval(value) : { type: 'empty' });
	let selectedPath = $state<string | null>(null);
	let paletteSearch = $state('');

	const FUNCTIONS = ['sqrt', 'abs', 'ln', 'log', 'sin', 'cos', 'tan', 'exp', 'floor', 'ceil', 'round', 'min', 'max'];
	const filteredVars = $derived(variables.filter((v) => !paletteSearch || v.label.toLowerCase().includes(paletteSearch.toLowerCase())));
	const filteredFns = $derived(FUNCTIONS.filter((f) => !paletteSearch || f.includes(paletteSearch.toLowerCase())));

	function syncText() {
		value = serializeToMeval(root);
	}

	function insertVariable(name: string) {
		const node: FormulaNode = { type: 'variable', name };
		if (selectedPath) {
			root = replaceAtPath(root, selectedPath, node);
		} else if (root.type === 'empty') {
			root = node;
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

<div class="space-y-3">
	<!-- Text input -->
	<div class="flex flex-col gap-1">
		<label class="text-sm font-medium">Formula</label>
		<input
			type="text"
			{value}
			oninput={handleTextInput}
			placeholder="e.g. sqrt(depth * 0.001)"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		{#if hasEmptySlots(root) && root.type !== 'empty'}
			<span class="text-xs text-severity-warning">Formula has empty slots (shown as ?)</span>
		{/if}
	</div>

	<!-- Palette -->
	<div class="flex gap-4">
		<div class="space-y-2 w-48 shrink-0">
			<input
				type="text"
				placeholder="Search..."
				bind:value={paletteSearch}
				class="w-full px-2 py-1 border border-brand-divider rounded text-xs bg-brand-surface"
			/>

			<!-- Variables -->
			<div class="text-xs font-semibold text-brand-muted">Variables</div>
			<div class="flex flex-wrap gap-1">
				{#each filteredVars as v, i}
					<button
						onclick={() => insertVariable(v.name)}
						class="px-2 py-0.5 text-xs rounded cursor-pointer border-none text-white"
						style:background={colorForVar(i)}
						title={v.label}
					>
						{v.name}
					</button>
				{/each}
			</div>

			<!-- Functions -->
			<div class="text-xs font-semibold text-brand-muted">Functions</div>
			<div class="flex flex-wrap gap-1">
				{#each filteredFns as fn}
					<button
						onclick={() => insertFunction(fn)}
						class="px-2 py-0.5 text-xs rounded cursor-pointer border border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg"
					>{fn}()</button>
				{/each}
			</div>

			<!-- Operators -->
			<div class="text-xs font-semibold text-brand-muted">Operators</div>
			<div class="flex gap-1">
				{#each ['+', '-', '*', '/', '^'] as op}
					<button
						onclick={() => addOperator(op)}
						class="w-7 h-7 text-sm font-mono rounded cursor-pointer border border-brand-divider bg-brand-surface hover:bg-brand-bg flex items-center justify-center"
					>{op}</button>
				{/each}
			</div>

			<!-- Constants -->
			<div class="text-xs font-semibold text-brand-muted">Constants</div>
			<div class="flex gap-1">
				{#each [0, 1, -1, 2, 0.001] as c}
					<button
						onclick={() => insertConstant(c)}
						class="px-2 py-0.5 text-xs font-mono rounded cursor-pointer border border-brand-divider bg-brand-surface hover:bg-brand-bg"
					>{c}</button>
				{/each}
			</div>

			<button onclick={clearAll} class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline mt-2">Clear formula</button>
		</div>

		<!-- Visual tree -->
		<div class="flex-1 min-h-[120px] p-3 border border-brand-divider rounded-md bg-brand-bg overflow-auto">
			{#if root.type === 'empty'}
				<div
					class="border-2 border-dashed border-brand-divider rounded-md p-4 text-center text-sm text-brand-muted cursor-pointer hover:border-brand-primary"
					role="button"
					tabindex="0"
					onclick={() => selectedPath = 'root'}
					onkeydown={(e) => e.key === 'Enter' && (selectedPath = 'root')}
				>
					Click a variable or function to start
				</div>
			{:else}
				{@render nodeView(root, 'root')}
			{/if}
		</div>
	</div>
</div>

{#snippet nodeView(node: FormulaNode, path: string)}
	{#if node.type === 'variable'}
		{@const vi = variables.findIndex((v) => v.name === node.name)}
		<span
			class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-white cursor-pointer {selectedPath === path ? 'ring-2 ring-brand-accent' : ''}"
			style:background={colorForVar(vi >= 0 ? vi : 7)}
			role="button" tabindex="0"
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
		>
			{node.name}
			<button onclick={(e) => { e.stopPropagation(); deleteAtPath(path); }} class="text-white/70 hover:text-white bg-transparent border-none cursor-pointer text-xs ml-0.5">&times;</button>
		</span>
	{:else if node.type === 'constant'}
		<span
			class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-brand-surface border border-brand-divider cursor-pointer {selectedPath === path ? 'ring-2 ring-brand-accent' : ''}"
			role="button" tabindex="0"
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
		>
			{node.value}
			<button onclick={(e) => { e.stopPropagation(); deleteAtPath(path); }} class="text-brand-muted hover:text-brand-text bg-transparent border-none cursor-pointer text-xs">&times;</button>
		</span>
	{:else if node.type === 'binary'}
		<span class="inline-flex items-center gap-1 flex-wrap">
			{@render nodeView(node.left, `${path}.left`)}
			<span class="font-mono text-sm font-bold text-brand-primary">{node.op}</span>
			{@render nodeView(node.right, `${path}.right`)}
		</span>
	{:else if node.type === 'function'}
		<span class="inline-flex items-center gap-0.5 flex-wrap">
			<span class="text-xs font-semibold text-brand-primary">{node.name}(</span>
			{#each node.args as arg, i}
				{#if i > 0}<span class="text-xs text-brand-muted">,</span>{/if}
				{@render nodeView(arg, `${path}.args.${i}`)}
			{/each}
			<span class="text-xs font-semibold text-brand-primary">)</span>
		</span>
	{:else}
		<span
			class="inline-block px-3 py-0.5 border-2 border-dashed border-brand-divider rounded text-xs text-brand-muted cursor-pointer hover:border-brand-primary {selectedPath === path ? 'border-brand-accent bg-brand-accent/10' : ''}"
			role="button" tabindex="0"
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
		>?</span>
	{/if}
{/snippet}
