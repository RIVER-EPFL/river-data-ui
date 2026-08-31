<script lang="ts">
	// The R source pane. CodeMirror rather than a textarea because the scripts carry a ~1150-line
	// prelude: line numbers, R highlighting and a marked error line are what make that navigable.
	//
	// One document holds the whole script, prelude included, so gutter line numbers match the stored
	// text and what is saved is what was loaded. The prelude is folded behind a block widget and
	// guarded by a change filter rather than split into a second editor, which would put the two
	// halves on separate line numbering.
	import { onMount } from 'svelte';
	import { Annotation, EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state';
	import {
		Decoration,
		EditorView,
		GutterMarker,
		WidgetType,
		gutterLineClass,
		highlightActiveLine,
		highlightActiveLineGutter,
		keymap,
		lineNumbers,
		type DecorationSet,
	} from '@codemirror/view';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import {
		HighlightStyle,
		StreamLanguage,
		bracketMatching,
		indentUnit,
		syntaxHighlighting,
	} from '@codemirror/language';
	import { r } from '@codemirror/legacy-modes/mode/r';
	import { tags } from '@lezer/highlight';
	import { describeScript } from './preludeBoundary';

	let {
		value = $bindable(),
		errorLine = null,
		entryFunction = 'tool',
		ariaLabel = 'R script',
	}: {
		value: string;
		errorLine?: number | null;
		entryFunction?: string;
		ariaLabel?: string;
	} = $props();

	let host: HTMLDivElement;
	// Raw rather than proxied: CodeMirror's view is not a plain object, and the effects below have to
	// re-run once it exists.
	let view = $state.raw<EditorView | null>(null);
	// Set while a transaction of ours is in flight, so the listener does not echo it back.
	let applying = false;

	const structure = $derived(describeScript(value, entryFunction));

	const setErrorLine = StateEffect.define<number | null>();
	const setShape = StateEffect.define<Shape & { fromLoad: boolean }>();
	const setPreludeOpen = StateEffect.define<boolean>();
	// Marks the transaction that swaps in another version's script, which is the one change allowed
	// to rewrite the guarded prelude range.
	const loadDocument = Annotation.define<boolean>();

	interface Shape {
		/** Offset of the newline closing the prelude, null when the script carries no prelude. */
		preludeEnd: number | null;
		preludeLines: number;
		entryLine: number | null;
	}
	interface EditorShape extends Shape {
		preludeOpen: boolean;
		/**
		 * The prelude arrived with the stored version, so it is vendored text this editor must hand
		 * back unchanged. A region that appeared under the author's own typing is theirs to edit.
		 */
		guarded: boolean;
	}

	class PreludeBarWidget extends WidgetType {
		lines: number;
		open: boolean;
		guarded: boolean;
		constructor(lines: number, open: boolean, guarded: boolean) {
			super();
			this.lines = lines;
			this.open = open;
			this.guarded = guarded;
		}
		eq(other: PreludeBarWidget) {
			return other.lines === this.lines && other.open === this.open && other.guarded === this.guarded;
		}
		toDOM(widgetView: EditorView) {
			const bar = document.createElement('button');
			bar.type = 'button';
			bar.className = 'cm-preludeBar';
			const scope = this.guarded ? ', read only' : '';
			bar.textContent = this.open
				? `Shared calculation functions, lines 1 to ${this.lines}${scope}. Hide`
				: `Shared calculation functions, ${this.lines} lines${scope}. Show`;
			bar.onclick = () => widgetView.dispatch({ effects: setPreludeOpen.of(!this.open) });
			return bar;
		}
		ignoreEvent() {
			return false;
		}
	}

	class EntryBadgeWidget extends WidgetType {
		name: string;
		constructor(name: string) {
			super();
			this.name = name;
		}
		eq(other: EntryBadgeWidget) {
			return other.name === this.name;
		}
		toDOM() {
			const badge = document.createElement('div');
			badge.className = 'cm-entryBadge';
			badge.textContent = `Entry point: the runner calls ${this.name}()`;
			return badge;
		}
	}

	function shapeDecorations(state: EditorState): DecorationSet {
		const shape = state.field(shapeState);
		const marks = [];
		if (shape.preludeEnd != null && shape.preludeLines >= 1) {
			const last = Math.min(shape.preludeLines, state.doc.lines);
			const to = state.doc.line(last).to;
			const widget = new PreludeBarWidget(shape.preludeLines, shape.preludeOpen, shape.guarded);
			marks.push(
				shape.preludeOpen
					? Decoration.widget({ widget, block: true, side: -1 }).range(0)
					: Decoration.replace({ widget, block: true }).range(0, to),
			);
		}
		if (shape.entryLine != null && shape.entryLine <= state.doc.lines) {
			const line = state.doc.line(shape.entryLine);
			const hidden =
				!shape.preludeOpen && shape.preludeEnd != null && shape.entryLine <= shape.preludeLines;
			if (!hidden) {
				marks.push(
					Decoration.widget({
						widget: new EntryBadgeWidget(entryFunction.trim() || 'tool'),
						block: true,
						side: -1,
					}).range(line.from),
				);
				marks.push(Decoration.line({ class: 'cm-entryLine' }).range(line.from));
			}
		}
		return Decoration.set(marks, true);
	}

	const shapeState = StateField.define<EditorShape>({
		create: () => ({
			preludeEnd: null,
			preludeLines: 0,
			entryLine: null,
			preludeOpen: true,
			guarded: false,
		}),
		update(current, tr) {
			let next = current;
			for (const e of tr.effects) {
				if (e.is(setShape)) {
					const { fromLoad, ...shape } = e.value;
					const carries = shape.preludeEnd != null;
					next = {
						...shape,
						// A loaded script opens on the authored part; one that grew a prelude under the
						// author's own typing keeps whatever they were looking at.
						preludeOpen: fromLoad ? !carries : !carries || current.preludeOpen,
						guarded: carries && (fromLoad || current.guarded),
					};
				}
				if (e.is(setPreludeOpen)) next = { ...next, preludeOpen: e.value };
			}
			return next;
		},
		provide: (f) => EditorView.decorations.compute([f, 'doc'], shapeDecorations),
	});

	// The prelude is vendored verbatim from the portal, so an edit to it would break the claim the
	// version's provenance makes. A script that matched nothing has preludeEnd null and is left
	// entirely writable.
	const guardPrelude = EditorState.changeFilter.of((tr) => {
		if (tr.annotation(loadDocument)) return true;
		const shape = tr.startState.field(shapeState, false);
		return shape?.guarded && shape.preludeEnd != null ? [0, shape.preludeEnd] : true;
	});

	class ErrorGutterMarker extends GutterMarker {
		elementClass = 'cm-errorGutter';
	}
	const errorMarker = new ErrorGutterMarker();

	const errorLineState = StateField.define<number | null>({
		create: () => null,
		update(current, tr) {
			let next = current;
			for (const e of tr.effects) if (e.is(setErrorLine)) next = e.value;
			return next;
		},
		provide: (f) => [
			EditorView.decorations.compute([f], (state): DecorationSet => {
				const line = state.field(f);
				if (line == null || line < 1 || line > state.doc.lines) return Decoration.none;
				return Decoration.set([
					Decoration.line({ class: 'cm-errorLine' }).range(state.doc.line(line).from),
				]);
			}),
			gutterLineClass.compute([f], (state) => {
				const line = state.field(f);
				if (line == null || line < 1 || line > state.doc.lines) return RangeSet.empty;
				return RangeSet.of([errorMarker.range(state.doc.line(line).from)]);
			}),
		],
	});

	// Colours come from the app's CSS variables, which are the same tokens the rest of the page uses.
	const highlight = HighlightStyle.define([
		{ tag: tags.comment, color: 'var(--color-brand-muted)', fontStyle: 'italic' },
		{ tag: tags.keyword, color: 'var(--color-brand-primary)', fontWeight: '600' },
		{ tag: tags.controlKeyword, color: 'var(--color-brand-primary)', fontWeight: '600' },
		{ tag: tags.string, color: 'var(--color-severity-ok)' },
		{ tag: tags.number, color: 'var(--color-brand-accent)' },
		{ tag: tags.bool, color: 'var(--color-brand-accent)' },
		{ tag: tags.null, color: 'var(--color-brand-accent)' },
		{ tag: tags.operator, color: 'var(--color-brand-text)' },
		{ tag: tags.variableName, color: 'var(--color-brand-text)' },
		{ tag: tags.function(tags.variableName), color: 'var(--color-brand-text)' },
	]);

	const theme = EditorView.theme({
		'&': {
			fontSize: '12px',
			backgroundColor: 'var(--color-brand-bg)',
			color: 'var(--color-brand-text)',
			height: '100%',
		},
		'.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
		'.cm-gutters': {
			backgroundColor: 'var(--color-brand-bg)',
			color: 'var(--color-brand-muted)',
			border: 'none',
			borderRight: '1px solid var(--color-brand-divider)',
		},
		'.cm-activeLine': { backgroundColor: 'var(--color-brand-surface)' },
		'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-brand-text)' },
		'&.cm-focused': { outline: 'none' },
		'.cm-errorLine': { backgroundColor: 'var(--color-severity-alarm-soft)' },
		'.cm-errorGutter': { color: 'var(--color-severity-alarm)', fontWeight: '700' },
		'.cm-scroller': { overflow: 'auto' },
		'.cm-preludeBar': {
			display: 'block',
			width: '100%',
			textAlign: 'left',
			cursor: 'pointer',
			font: 'inherit',
			padding: '4px 8px',
			color: 'var(--color-brand-muted)',
			backgroundColor: 'var(--color-brand-surface)',
			border: '1px solid var(--color-brand-divider)',
			borderRadius: '4px',
		},
		'.cm-entryBadge': {
			padding: '2px 8px',
			color: 'var(--color-brand-accent)',
			fontWeight: '600',
		},
		'.cm-entryLine': { backgroundColor: 'var(--color-brand-surface)' },
	});

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					lineNumbers(),
					highlightActiveLine(),
					highlightActiveLineGutter(),
					history(),
					bracketMatching(),
					indentUnit.of('  '),
					keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
					StreamLanguage.define(r),
					syntaxHighlighting(highlight),
					errorLineState,
					shapeState,
					guardPrelude,
					theme,
					EditorView.lineWrapping,
					EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged || applying) return;
						value = update.state.doc.toString();
					}),
				],
			}),
		});
		// Whatever the editor mounts with came from storage, the same as a version loaded later.
		view.dispatch({ effects: setShape.of(currentShape(true)) });
		return () => {
			view?.destroy();
			view = null;
		};
	});

	function currentShape(fromLoad: boolean): Shape & { fromLoad: boolean } {
		return {
			preludeEnd: structure.preludeEnd,
			preludeLines: structure.preludeLines,
			entryLine: structure.entryLine,
			fromLoad,
		};
	}

	/** The first line the author owns, which is where a script carrying a prelude opens. */
	function authoredStartLine(): number {
		return structure.preludeEnd == null ? 1 : Math.min(structure.preludeLines + 1, Math.max(1, value.split('\n').length));
	}

	// A version loaded into the editor replaces the document; typing does not come back through here.
	$effect(() => {
		const next = value;
		if (!view || view.state.doc.toString() === next) return;
		applying = true;
		view.dispatch({
			annotations: loadDocument.of(true),
			changes: { from: 0, to: view.state.doc.length, insert: next },
			effects: setShape.of(currentShape(true)),
		});
		const line = authoredStartLine();
		if (line <= view.state.doc.lines) {
			view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
		}
		applying = false;
	});

	// Typing can move the entry definition or take the script out of the seeded shape entirely.
	$effect(() => {
		const shape = currentShape(false);
		view?.dispatch({ effects: setShape.of(shape) });
	});

	$effect(() => {
		const line = errorLine;
		if (!view) return;
		// A parse error anywhere is reported against the real script, so one inside the prelude has to
		// unfold it rather than be marked on lines nobody can see.
		const shape = view.state.field(shapeState);
		const inFoldedPrelude =
			line != null && shape.preludeEnd != null && !shape.preludeOpen && line <= shape.preludeLines;
		view.dispatch({
			effects: [
				setErrorLine.of(line ?? null),
				...(inFoldedPrelude ? [setPreludeOpen.of(true)] : []),
			],
		});
		if (line != null && line >= 1 && line <= view.state.doc.lines) {
			view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) });
		}
	});
</script>

<div bind:this={host} class="h-full overflow-hidden rounded-md border border-brand-divider bg-brand-bg"></div>
