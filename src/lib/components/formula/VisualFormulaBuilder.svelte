<script lang="ts">
	import { type FormulaNode, parseFromMeval, serializeToMeval, replaceAtPath, hasEmptySlots, wrapWithOp } from './ast';
	import { tokens } from '$lib/charts/tokens';
	import type { Constant } from '$api/crud';
	import Button from '$components/ui/Button.svelte';

	let {
		value = $bindable(''),
		variables = [],
		constants = [],
	}: {
		value: string;
		variables: Array<{ name: string; label: string; category?: string }>;
		constants?: Constant[];
	} = $props();

	let root = $state<FormulaNode>(value ? parseFromMeval(value) : { type: 'empty' });
	let selectedPath = $state<string | null>(null);
	let paletteSearch = $state('');
	let editingConstantPath = $state<string | null>(null);
	let dragOverPath = $state<string | null>(null);

	const FUNCTIONS = ['sqrt', 'abs', 'ln', 'log', 'sin', 'cos', 'tan', 'exp', 'floor', 'ceil', 'round', 'min', 'max'];
	const MULTI_ARG_FUNCTIONS = new Set(['min', 'max']);

	const constantNames = $derived(new Set(constants.map((c) => c.name)));
	const constantByName = $derived(new Map(constants.map((c) => [c.name, c])));

	const filteredVars = $derived(
		variables.filter((v) => {
			if (constantNames.has(v.name)) return false;
			if (!paletteSearch) return true;
			const q = paletteSearch.toLowerCase();
			return v.label.toLowerCase().includes(q) || v.name.toLowerCase().includes(q);
		})
	);
	const filteredFns = $derived(FUNCTIONS.filter((f) => !paletteSearch || f.includes(paletteSearch.toLowerCase())));
	const filteredConstants = $derived(
		constants.filter((c) => !paletteSearch || c.name.toLowerCase().includes(paletteSearch.toLowerCase()))
	);

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

	type DragPayload =
		| { kind: 'variable'; name: string }
		| { kind: 'constant'; name: string }
		| { kind: 'function'; name: string }
		| { kind: 'operator'; op: string }
		| { kind: 'number' };

	let dragPayload: DragPayload | null = null;

	function onDragStart(e: DragEvent, payload: DragPayload) {
		dragPayload = payload;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'copy';
			e.dataTransfer.setData('text/plain', JSON.stringify(payload));
		}
	}

	function onDragOver(e: DragEvent, path: string) {
		if (!dragPayload) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		dragOverPath = path;
	}

	function onDragLeave() {
		dragOverPath = null;
	}

	function payloadToNode(payload: DragPayload, existing?: FormulaNode | null): FormulaNode {
		switch (payload.kind) {
			case 'variable':
			case 'constant':
				return { type: 'variable', name: payload.name };
			case 'function': {
				const argCount = MULTI_ARG_FUNCTIONS.has(payload.name) ? 2 : 1;
				const firstArg = existing && existing.type !== 'empty' ? existing : { type: 'empty' as const };
				const rest = Array(argCount - 1).fill({ type: 'empty' });
				return { type: 'function', name: payload.name, args: [firstArg, ...rest] };
			}
			case 'operator':
				if (existing && existing.type !== 'empty') return wrapWithOp(existing, payload.op);
				return { type: 'binary', op: payload.op, left: { type: 'empty' }, right: { type: 'empty' } };
			case 'number':
				return { type: 'constant', value: 0 };
		}
	}

	function onDrop(e: DragEvent, path: string) {
		e.preventDefault();
		e.stopPropagation();
		dragOverPath = null;
		if (!dragPayload) return;
		const existing = getNodeFromPath(path);
		const node = payloadToNode(dragPayload, existing);
		root = replaceAtPath(root, path, node);
		dragPayload = null;
		selectedPath = null;
		if (node.type === 'constant' && dragPayload === null) editingConstantPath = path;
		syncText();
	}

	function onDropEmpty(e: DragEvent) {
		e.preventDefault();
		if (!dragPayload) return;
		const node = payloadToNode(dragPayload, null);
		root = node;
		dragPayload = null;
		selectedPath = null;
		syncText();
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

	function appendNumber() {
		const node: FormulaNode = { type: 'constant', value: 0 };
		if (root.type === 'empty') {
			root = node;
			editingConstantPath = 'root';
		} else {
			root = { type: 'binary', op: '*', left: root, right: node };
			editingConstantPath = 'root.right';
		}
		syncText();
	}

	function firstEmptyPath(node: FormulaNode, path: string): string | null {
		if (node.type === 'empty') return path;
		if (node.type === 'binary') {
			return firstEmptyPath(node.left, `${path}.left`) ?? firstEmptyPath(node.right, `${path}.right`);
		}
		if (node.type === 'function') {
			for (let i = 0; i < node.args.length; i++) {
				const found = firstEmptyPath(node.args[i], `${path}.args.${i}`);
				if (found) return found;
			}
		}
		return null;
	}

	function clickPalette(payload: DragPayload) {
		if (selectedPath) {
			const existing = getNodeFromPath(selectedPath);
			const node = payloadToNode(payload, existing);
			root = replaceAtPath(root, selectedPath, node);
			selectedPath = payload.kind === 'operator' ? `${selectedPath}.right` : null;
			if (node.type === 'constant') editingConstantPath = selectedPath;
			syncText();
			return;
		}

		if (root.type === 'empty') {
			root = payloadToNode(payload, null);
			if (root.type === 'constant') editingConstantPath = 'root';
			syncText();
			return;
		}

		if (payload.kind === 'operator') {
			root = wrapWithOp(root, payload.op);
			selectedPath = 'root.right';
			syncText();
			return;
		}

		const slot = firstEmptyPath(root, 'root');
		if (slot) {
			const node = payloadToNode(payload, null);
			root = replaceAtPath(root, slot, node);
			if (node.type === 'constant') editingConstantPath = slot;
			syncText();
			return;
		}

		const node = payloadToNode(payload, null);
		root = { type: 'binary', op: '*', left: root, right: node };
		if (node.type === 'constant') editingConstantPath = 'root.right';
		syncText();
	}

	function paletteKeydown(e: KeyboardEvent, payload: DragPayload) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			clickPalette(payload);
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

	function colorForVar(name: string): string {
		const idx = variables.findIndex((v) => v.name === name);
		const i = idx >= 0 ? idx : Math.abs(hashCode(name)) % tokens.dataViz.length;
		return tokens.dataViz[i % tokens.dataViz.length];
	}

	function hashCode(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
		return h;
	}

	function fmtNumber(v: number): string {
		if (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)) return v.toExponential(2);
		return String(v);
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
	<div class="px-4 py-3 border-b border-brand-divider bg-brand-bg">
		<input
			type="text"
			{value}
			oninput={handleTextInput}
			placeholder="Type formula directly, or drag tokens from the palette into the canvas…"
			class="w-full px-3 py-2 border border-brand-divider rounded bg-brand-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		{#if hasEmptySlots(root) && root.type !== 'empty'}
			<span class="text-xs text-severity-warning mt-1 block">Formula has empty slots (shown as ?)</span>
		{/if}
	</div>

	<div class="flex min-h-[260px]">
		<div class="w-64 shrink-0 border-r border-brand-divider bg-brand-bg p-3 space-y-3 overflow-y-auto max-h-[460px]">
			<input
				type="text"
				placeholder="Search…"
				bind:value={paletteSearch}
				class="w-full px-2 py-1.5 border border-brand-divider rounded text-xs bg-brand-surface focus:outline-none focus:ring-1 focus:ring-brand-primary/30"
			/>

			{#each [...groupedVars.entries()] as [category, vars]}
				<div>
					<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">{category}</div>
					<div class="space-y-1">
						{#each vars as v}
							<div
								draggable="true"
								role="button"
								tabindex="0"
								ondragstart={(e) => onDragStart(e, { kind: 'variable', name: v.name })}
								onclick={() => clickPalette({ kind: 'variable', name: v.name })}
								onkeydown={(e) => paletteKeydown(e, { kind: 'variable', name: v.name })}
								class="px-2 py-1.5 rounded text-xs cursor-grab active:cursor-grabbing border border-transparent hover:border-brand-primary/40 flex items-center gap-2"
								style:background="{colorForVar(v.name)}18"
								title="Click or drag into formula"
							>
								<span class="w-2 h-2 rounded-full shrink-0" style:background={colorForVar(v.name)}></span>
								<span class="flex-1 min-w-0">
									<span class="block font-medium text-brand-text truncate">{v.label}</span>
									<span class="block font-mono text-brand-muted text-[10px] truncate">{v.name}</span>
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}

			{#if filteredFns.length > 0}
				<div>
					<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">Functions</div>
					<div class="flex flex-wrap gap-1">
						{#each filteredFns as fn}
							<div
								draggable="true"
								role="button"
								tabindex="0"
								ondragstart={(e) => onDragStart(e, { kind: 'function', name: fn })}
								onclick={() => clickPalette({ kind: 'function', name: fn })}
								onkeydown={(e) => paletteKeydown(e, { kind: 'function', name: fn })}
								class="px-2 py-1 text-xs rounded cursor-grab active:cursor-grabbing border border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg"
								title="Click or drag {fn}() into formula; drop onto a token to wrap it"
							>{fn}()</div>
						{/each}
					</div>
				</div>
			{/if}

			<div>
				<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">Operators</div>
				<div class="flex gap-1 flex-wrap">
					{#each ['+', '-', '*', '/', '^'] as op}
						<div
							draggable="true"
							role="button"
							tabindex="0"
							ondragstart={(e) => onDragStart(e, { kind: 'operator', op })}
							onclick={() => clickPalette({ kind: 'operator', op })}
							onkeydown={(e) => paletteKeydown(e, { kind: 'operator', op })}
							class="w-9 h-9 text-sm font-mono rounded cursor-grab active:cursor-grabbing border border-brand-divider bg-brand-surface hover:bg-brand-bg flex items-center justify-center font-bold"
							aria-label="Insert {op} operator"
						>{op}</div>
					{/each}
				</div>
			</div>

			{#if filteredConstants.length > 0}
				<div>
					<div class="text-xs font-semibold text-brand-muted mb-1.5 uppercase tracking-wider">Named Constants</div>
					<div class="space-y-1">
						{#each filteredConstants as c}
							<div
								draggable="true"
								role="button"
								tabindex="0"
								ondragstart={(e) => onDragStart(e, { kind: 'constant', name: c.name })}
								onclick={() => clickPalette({ kind: 'constant', name: c.name })}
								onkeydown={(e) => paletteKeydown(e, { kind: 'constant', name: c.name })}
								class="px-2 py-1 rounded cursor-grab active:cursor-grabbing border border-brand-divider bg-brand-surface flex items-baseline justify-between gap-2"
								title={c.description || c.name}
							>
								<span class="font-mono text-xs text-brand-text">{c.name}</span>
								<span class="font-mono text-[10px] text-brand-muted whitespace-nowrap">
									{fmtNumber(c.value)}{c.units ? ` ${c.units}` : ''}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<Button variant="ghost" size="sm" class="text-severity-alarm" onclick={clearAll}>Clear formula</Button>
		</div>

		<div class="flex-1 p-4 overflow-auto flex flex-col items-start gap-3">
			{#if root.type === 'empty'}
				<div
					role="region"
					aria-label="Formula drop zone"
					class="w-full border-2 border-dashed rounded-md p-8 text-center text-sm text-brand-muted transition-colors {dragOverPath === 'root' ? 'border-brand-primary bg-brand-primary/5' : 'border-brand-divider'}"
					ondragover={(e) => onDragOver(e, 'root')}
					ondragleave={onDragLeave}
					ondrop={onDropEmpty}
				>
					Drag a variable, function, or constant here to start
				</div>
			{:else}
				<div class="text-sm leading-relaxed">
					{@render nodeView(root, 'root')}
				</div>
			{/if}

			<button
				onclick={appendNumber}
				class="px-2 py-1 text-[11px] font-mono rounded border border-dashed border-brand-divider bg-brand-bg text-brand-muted cursor-pointer hover:border-brand-primary hover:text-brand-primary"
				title="Add a literal number you can type directly"
			>+ number</button>
		</div>
	</div>
</div>

{#snippet nodeView(node: FormulaNode, path: string)}
	{#if node.type === 'variable'}
		{@const isConstant = constantNames.has(node.name)}
		{@const cdef = constantByName.get(node.name)}
		{@const label = isConstant ? node.name : (variables.find((v) => v.name === node.name)?.label ?? node.name)}
		<span
			class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs cursor-grab active:cursor-grabbing transition-shadow {selectedPath === path ? 'ring-2 ring-brand-accent shadow-md' : 'hover:shadow-sm'} {dragOverPath === path ? 'ring-2 ring-brand-primary' : ''}"
			class:text-white={!isConstant}
			class:bg-brand-surface={isConstant}
			class:border={isConstant}
			class:border-brand-divider={isConstant}
			style:background={isConstant ? undefined : colorForVar(node.name)}
			role="button" tabindex="0"
			draggable="true"
			ondragstart={(e) => onDragStart(e, isConstant ? { kind: 'constant', name: node.name } : { kind: 'variable', name: node.name })}
			ondragover={(e) => onDragOver(e, path)}
			ondragleave={onDragLeave}
			ondrop={(e) => onDrop(e, path)}
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
		>
			{#if isConstant}
				<span class="font-mono text-brand-text">{node.name}</span>
				{#if cdef}<span class="text-[10px] text-brand-muted font-mono">{fmtNumber(cdef.value)}{cdef.units ? ` ${cdef.units}` : ''}</span>{/if}
			{:else}
				{label}
			{/if}
			<button onclick={(e) => { e.stopPropagation(); deleteAtPath(path); }} aria-label="Delete token" class="bg-transparent border-none cursor-pointer text-xs ml-0.5 {isConstant ? 'text-brand-muted hover:text-brand-text' : 'text-white/60 hover:text-white'}">&times;</button>
		</span>
	{:else if node.type === 'constant'}
		{#if editingConstantPath === path}
			<input
				type="number"
				step="any"
				value={node.value}
				class="w-24 px-1.5 py-0.5 text-xs font-mono border border-brand-primary rounded bg-brand-surface focus:outline-none focus:ring-1 focus:ring-brand-primary"
				onblur={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (!isNaN(v)) updateConstant(path, v); else editingConstantPath = null; }}
				onkeydown={(e) => { if (e.key === 'Enter') { const v = parseFloat((e.target as HTMLInputElement).value); if (!isNaN(v)) updateConstant(path, v); } if (e.key === 'Escape') editingConstantPath = null; }}
			/>
		{:else}
			<span
				class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-brand-surface border border-brand-divider cursor-pointer transition-shadow {selectedPath === path ? 'ring-2 ring-brand-accent shadow-md' : 'hover:shadow-sm'} {dragOverPath === path ? 'ring-2 ring-brand-primary' : ''}"
				role="button" tabindex="0"
				ondragover={(e) => onDragOver(e, path)}
				ondragleave={onDragLeave}
				ondrop={(e) => onDrop(e, path)}
				onclick={() => { editingConstantPath = path; }}
				onkeydown={(e) => e.key === 'Enter' && (editingConstantPath = path)}
				title="Click to edit value"
			>
				{node.value}
				<button onclick={(e) => { e.stopPropagation(); deleteAtPath(path); }} aria-label="Delete token" class="text-brand-muted hover:text-brand-text bg-transparent border-none cursor-pointer text-xs">&times;</button>
			</span>
		{/if}
	{:else if node.type === 'binary'}
		<span class="inline-flex items-center gap-1.5 flex-wrap">
			{@render nodeView(node.left, `${path}.left`)}
			<span class="font-mono text-base font-bold text-brand-primary">{node.op}</span>
			{@render nodeView(node.right, `${path}.right`)}
		</span>
	{:else if node.type === 'function'}
		<span class="inline-flex items-center gap-0.5 flex-wrap"
			ondragover={(e) => onDragOver(e, path)}
			ondragleave={onDragLeave}
			ondrop={(e) => onDrop(e, path)}
			role="group"
		>
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
					aria-label="Add argument"
				>+</button>
			{/if}
			<span class="text-xs font-bold text-brand-primary">)</span>
		</span>
	{:else}
		<span
			class="inline-block px-3 py-1 border-2 border-dashed rounded-md text-xs text-brand-muted cursor-pointer transition-colors {dragOverPath === path ? 'border-brand-primary bg-brand-primary/10' : selectedPath === path ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-divider hover:border-brand-primary'}"
			role="button" tabindex="0"
			ondragover={(e) => onDragOver(e, path)}
			ondragleave={onDragLeave}
			ondrop={(e) => onDrop(e, path)}
			onclick={() => selectedPath = path}
			onkeydown={(e) => e.key === 'Enter' && (selectedPath = path)}
			aria-label="Select empty slot"
		>?</span>
	{/if}
{/snippet}
