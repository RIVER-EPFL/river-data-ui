<script lang="ts">
	import { type DragPayload, type FormulaNode, parseFromMeval, serializeToMeval, getNodeAtPath, replaceAtPath, hasEmptySlots, wrapWithOp, payloadToNode, readPayload } from './ast';
	import {
		applyCompletion,
		callAt,
		completionsFor,
		identifierAt,
		lintFormula,
		type Completion,
		type Diagnostic
	} from '$lib/formula/lint';
	import type { Constant } from '$api/crud';
	import { tokens } from '$lib/charts/tokens';
	import Button from '$components/ui/Button.svelte';
	import FormulaPalette from './FormulaPalette.svelte';

	let {
		value = $bindable(''),
		variables = [],
		constants = [],
		steps = [],
		hasCurve = false,
		ownCode = undefined,
		diagnostics = $bindable([]),
		palette = true,
	}: {
		value: string;
		variables: Array<{ name: string; label: string; category?: string }>;
		constants?: Constant[];
		/** Earlier formulas of the same calculation, readable by their code. */
		steps?: string[];
		/** Whether this formula declares a curve slot, which binds the two coefficients. */
		hasCurve?: boolean;
		/** The code of the formula being edited: naming itself is a cycle. */
		ownCode?: string;
		/** What the text says wrong, read out so the page can hold Save while one stands. */
		diagnostics?: Diagnostic[];
		/** Whether the builder mounts its own palette; without one, a palette outside it calls `pick`. */
		palette?: boolean;
	} = $props();

	let root = $state<FormulaNode>(value ? parseFromMeval(value) : { type: 'empty' });
	let selectedPath = $state<string | null>(null);
	let textInput = $state<HTMLInputElement | null>(null);
	let editingConstantPath = $state<string | null>(null);
	let dragOverPath = $state<string | null>(null);

	const MULTI_ARG_FUNCTIONS = new Set(['min', 'max']);

	const constantNames = $derived(new Set(constants.map((c) => c.name)));
	const constantByName = $derived(new Map(constants.map((c) => [c.name, c])));

	const labels = $derived(Object.fromEntries(variables.map((v) => [v.name, v.label])));

	function syncText() {
		value = serializeToMeval(root);
	}

	let dragPayload: DragPayload | null = null;

	function onDragStart(e: DragEvent, payload: DragPayload) {
		dragPayload = payload;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'copy';
			e.dataTransfer.setData('text/plain', JSON.stringify(payload));
		}
	}

	// A drag from a palette outside the builder is known only by its transfer, which the browser
	// withholds until the drop.
	function carriesPayload(e: DragEvent): boolean {
		return dragPayload !== null || Boolean(e.dataTransfer?.types.includes('text/plain'));
	}

	function onDragOver(e: DragEvent, path: string) {
		if (!carriesPayload(e)) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		dragOverPath = path;
	}

	function onDragLeave() {
		dragOverPath = null;
	}

	function onDrop(e: DragEvent, path: string) {
		e.preventDefault();
		e.stopPropagation();
		dragOverPath = null;
		const payload = dragPayload ?? readPayload(e.dataTransfer);
		if (!payload) return;
		const existing = getNodeAtPath(root, path);
		const node = payloadToNode(payload, existing);
		root = replaceAtPath(root, path, node);
		dragPayload = null;
		selectedPath = null;
		if (node.type === 'constant' && dragPayload === null) editingConstantPath = path;
		syncText();
	}

	function onDropEmpty(e: DragEvent) {
		e.preventDefault();
		const payload = dragPayload ?? readPayload(e.dataTransfer);
		if (!payload) return;
		const node = payloadToNode(payload, null);
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
		const node = getNodeAtPath(root, path);
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

	/**
	 * A palette term picked by click or key: it fills the selected slot, replaces the selected term,
	 * takes an empty formula, wraps the formula in an operator, or fills the first empty slot.
	 */
	export function pick(payload: DragPayload) {
		if (selectedPath) {
			const existing = getNodeAtPath(root, selectedPath);
			const node = payloadToNode(payload, existing);
			root = replaceAtPath(root, selectedPath, node);
			selectedPath = payload.kind === 'operator' ? `${selectedPath}.right` : null;
			syncText();
			return;
		}

		if (root.type === 'empty') {
			root = payloadToNode(payload, null);
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
			syncText();
			return;
		}

		const node = payloadToNode(payload, null);
		root = { type: 'binary', op: '*', left: root, right: node };
		syncText();
	}

	function clearAll() {
		root = { type: 'empty' };
		selectedPath = null;
		value = '';
	}

	function handleTextInput(e: Event) {
		const input = e.target as HTMLInputElement;
		value = input.value;
		caret = input.selectionStart ?? input.value.length;
		completionsDismissed = false;
		completionIndex = 0;
		try { root = parseFromMeval(input.value); } catch { /* the diagnostics say what is wrong */ }
	}

	// Read on every keystroke, so a name that is not a parameter is named here rather than by the
	// server after the save.
	let caret = $state(0);
	$effect(() => {
		diagnostics = lintFormula(value, {
			variables: variables.map((v) => v.name),
			constants: constants.map((c) => c.name),
			steps,
			hasCurve,
			ownCode,
		});
	});
	const signature = $derived(callAt(value, caret));

	// What the caret is on, offered while it is being typed: the list is what teaches the names,
	// so the palette does not have to be read top to bottom.
	let completionsDismissed = $state(false);
	const completionTarget = $derived(completionsDismissed ? null : identifierAt(value, caret));
	const completions = $derived<Completion[]>(
		completionTarget
			? completionsFor(completionTarget.prefix, {
					variables: variables.map((v) => v.name),
					constants: constants.map((c) => c.name),
					steps,
					hasCurve,
					ownCode,
					labels,
				})
			: []
	);
	let completionIndex = $state(0);
	const activeCompletion = $derived(completions[Math.min(completionIndex, completions.length - 1)]);

	function accept(name: string) {
		const applied = applyCompletion(value, caret, name);
		value = applied.text;
		caret = applied.caret;
		completionsDismissed = true;
		try { root = parseFromMeval(value); } catch { /* the diagnostics say what is wrong */ }
		if (textInput) {
			textInput.value = applied.text;
			textInput.setSelectionRange(applied.caret, applied.caret);
			textInput.focus();
		}
	}

	function textKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && completions.length > 0) {
			e.preventDefault();
			completionsDismissed = true;
			return;
		}
		if (completions.length === 0) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : completions.length - 1;
			completionIndex = (Math.min(completionIndex, completions.length - 1) + step) % completions.length;
			return;
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			if (!activeCompletion) return;
			e.preventDefault();
			accept(activeCompletion.name);
		}
	}

	function syncCaret(e: Event) {
		const input = e.target as HTMLInputElement;
		caret = input.selectionStart ?? input.value.length;
		completionsDismissed = true;
	}

	function colorForVar(name: string): string {
		const idx = variables.findIndex((v) => v.name === name);
		const i = idx >= 0 ? idx : Math.abs(hashCode(name)) % tokens.dataViz.length;
		return tokens.dataViz[i % tokens.dataViz.length];
	}

	/** Put the caret in the formula's text field, which also scrolls it into view. */
	export function focus() {
		textInput?.focus();
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
		<div class="relative">
			<input
				bind:this={textInput}
				type="text"
				{value}
				oninput={handleTextInput}
				onkeydown={textKeydown}
				onclick={syncCaret}
				placeholder="Type formula directly, or drag tokens from the palette into the canvas…"
				role="combobox"
				aria-expanded={completions.length > 0}
				aria-controls="formula-completions"
				aria-autocomplete="list"
				class="w-full px-3 py-2 border border-brand-divider rounded bg-brand-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
			/>
			{#if completions.length > 0}
				<ul
					id="formula-completions"
					aria-label="Name completions"
					class="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded border border-brand-divider bg-brand-surface shadow-lg py-1"
				>
					{#each completions as completion (completion.name)}
						<li>
							<button
								type="button"
								aria-selected={completion.name === activeCompletion?.name}
								onmousedown={(e) => { e.preventDefault(); accept(completion.name); }}
								class="w-full flex items-baseline gap-2 px-3 py-1 text-left text-xs {completion.name === activeCompletion?.name ? 'bg-brand-primary/10' : 'hover:bg-brand-bg'}"
							>
								<span class="font-mono text-brand-text">{completion.name}</span>
								{#if completion.label && completion.label !== completion.name}
									<span class="flex-1 truncate text-brand-muted">{completion.label}</span>
								{/if}
								<span class="ml-auto text-[10px] uppercase tracking-wider text-brand-muted">{completion.kind}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		{#if signature}
			<span class="text-xs text-brand-muted mt-1 block font-mono">
				{signature.name}({#if signature.arity === null}…{:else}{#each Array(signature.arity) as _, i (i)}<span
							class={i === signature.argument ? 'text-brand-primary font-semibold' : ''}
							>{i > 0 ? ', ' : ''}arg{i + 1}</span
						>{/each}{/if})
			</span>
		{/if}
		{#each diagnostics as diagnostic, i (i)}
			<span class="text-xs text-severity-alarm mt-1 block">
				{diagnostic.message}{#if diagnostic.suggestion}. Did you mean
					<span class="font-mono">{diagnostic.suggestion}</span>?{/if}
			</span>
		{/each}
		{#if hasEmptySlots(root) && root.type !== 'empty'}
			<span class="text-xs text-severity-warning mt-1 block">Formula has empty slots (shown as ?)</span>
		{/if}
	</div>

	<div class="flex min-h-[260px]">
		{#if palette}
			<FormulaPalette
				{variables}
				{constants}
				onpick={pick}
				ondrag={(payload) => (dragPayload = payload)}
				class="w-56 shrink-0 border-r border-brand-divider bg-brand-bg p-2 overflow-y-auto max-h-[460px]"
			/>
		{/if}

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

			<Button variant="secondary" size="sm" class="font-mono" onclick={appendNumber} title="Add a literal number you can type directly">+ number</Button>
			{#if root.type !== 'empty'}
				<Button variant="ghost" size="sm" class="text-severity-alarm" onclick={clearAll}>Clear formula</Button>
			{/if}
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
				{#if cdef}<span class="text-numeric text-brand-muted font-mono">{fmtNumber(cdef.value)}{cdef.units ? ` ${cdef.units}` : ''}</span>{/if}
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

