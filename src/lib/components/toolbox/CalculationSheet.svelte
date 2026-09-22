<script lang="ts">
	import type { CellProperties, GridSettings, HotInstance } from 'handsontable';
	import type { RunTraceStep } from '$api/service';
	import type { EditableFormula } from '$lib/calculations/editor';
	import {
		cellEdit,
		contributors,
		dropOn,
		linksOf,
		type SheetBlock,
		type SheetEdit,
		type SheetRow,
		type SheetSelection,
	} from '$lib/calculations/sheet';
	import type { DragPayload } from '$components/formula/ast';
	import Button from '$components/ui/Button.svelte';
	import { identifiers } from '$lib/formula/lint';
	import SheetGrid from '$components/ui/SheetGrid.svelte';

	// The portal's three tables, side by side: what the visit and the catalog supplied, the steps
	// of the calculation, and what it publishes with the statistics of the repeats. Parameters go
	// down and replicate letters across, so a set reads the way the lab writes it down.
	//
	// Selecting a cell lights what its row reads and what reads it, across all three tables.

	interface Props {
		blocks: SheetBlock[];
		formulas: EditableFormula[];
		trace?: RunTraceStep[];
		selected?: SheetSelection | null;
		/** The values on screen were computed from an earlier input state than the one showing. */
		stale?: boolean;
		onselect?: (selection: SheetSelection | null) => void;
		/** A cell was typed, pasted or filled into. Without it the tables are read-only. */
		onedit?: (edit: SheetEdit) => void;
		/** A palette entry was dropped on a block. */
		ondrop?: (block: SheetBlock['key'], row: SheetRow | null, payload: DragPayload) => void;
		/** Append a row to the steps or the outputs. */
		onadd?: (block: 'steps' | 'outputs') => void;
	}

	let {
		blocks,
		formulas,
		trace = [],
		selected = $bindable(null),
		stale = false,
		onselect,
		onedit,
		ondrop,
		onadd,
	}: Props = $props();

	/** A band heading, or one of the block's rows, in the order the grid draws them. */
	type Entry = { band: string; row: SheetRow | null };

	const BAND_TITLES: Record<string, string> = {
		replicated: 'Per replicate',
		single: 'One per visit',
		fixed: 'Constants, site and curves',
		step: 'Steps',
		read: 'Read by a later formula',
		final: 'Published',
		statistics: 'Mean and standard deviation',
	};

	function entriesOf(block: SheetBlock): Entry[] {
		const entries: Entry[] = [];
		let band = '';
		for (const row of block.rows) {
			if (row.band !== band) {
				band = row.band;
				entries.push({ band, row: null });
			}
			entries.push({ band, row });
		}
		return entries;
	}

	const entries = $derived(new Map(blocks.map((b) => [b.key, entriesOf(b)])));

	function fmt(value: number | null): string {
		if (value === null) return '';
		return Number.isInteger(value) ? String(value) : value.toPrecision(6);
	}

	function dataOf(block: SheetBlock): string[][] {
		const width = Math.max(1, block.columns.length);
		return (entries.get(block.key) ?? []).map(({ band, row }) =>
			row
				? [row.label, ...row.cells.slice(0, width).map((c) => (c.skipped ? '—' : fmt(c.value)))]
				: [BAND_TITLES[band] ?? band, ...Array.from({ length: width }, () => '')],
		);
	}

	const selectedRow = $derived(
		selected
			? ((blocks.find((b) => b.key === selected!.block)?.rows ?? []).find(
					(r) => r.key === selected!.key,
				) ?? null)
			: null,
	);
	// What the selected row reads: the codes of the set, and the inputs its formula names.
	const reads = $derived(
		new Set(
			selectedRow?.code
				? [
						...linksOf(formulas, selectedRow.code).reads,
						...identifiers(selectedRow.note ?? '').map((i) => i.name),
					]
				: selectedRow?.aggregateOf
					? [selectedRow.aggregateOf]
					: [],
		),
	);
	const readBy = $derived(
		new Set(selectedRow?.code ? linksOf(formulas, selectedRow.code).readBy : []),
	);

	const CLASSES = [
		'htRight',
		'htNumeric',
		'sheet-band',
		'sheet-reads',
		'sheet-read-by',
		'sheet-unused',
		'sheet-stale',
	];

	/** What a cell would do if it were typed into, which is also what makes it writable. */
	function editOf(row: SheetRow | null, column: number, text: string): SheetEdit | null {
		return row && onedit ? cellEdit(row, column, text) : null;
	}

	function settingsOf(block: SheetBlock): Omit<GridSettings, 'data' | 'licenseKey' | 'themeName'> {
		const rows = entries.get(block.key) ?? [];
		return {
			colHeaders: [block.title, ...(block.columns.length > 0 ? block.columns : ['Value'])],
			rowHeaders: false,
			wordWrap: false,
			width: '100%',
			height: 'auto',
			colWidths: (index: number) => (index === 0 ? 180 : 90),
			manualColumnResize: true,
			fillHandle: false,
			outsideClickDeselects: false,
			cells: (row: number, column: number) => ({
				readOnly: !editOf(rows[row]?.row ?? null, column, ''),
				renderer: (
					_hot: unknown,
					td: HTMLTableCellElement,
					gridRow: number,
					column: number,
					_prop: unknown,
					value: unknown,
					_meta: CellProperties,
				) => renderCell(block, rows, td, gridRow, column, value),
			}),
			beforeChange: (changes: Array<[number, string | number, unknown, unknown] | null>) => {
				for (const change of changes) {
					if (!change) continue;
					const [row, prop, , next] = change;
					const edit = editOf(
						rows[row]?.row ?? null,
						Number(prop),
						next == null ? '' : String(next),
					);
					if (edit) onedit?.(edit);
				}
			},
			// A band heading is not a cell, and a repaint re-emits each grid's own selection: neither
			// is written back, or the table last clicked would take the selection from the new one.
			afterSelection: (row: number, column: number) => {
				// Only the table the person is working in speaks: the others re-emit what they still
				// hold whenever they are drawn.
				if (repainting || grids.get(block.key)?.isListening() === false) return;
				const entry = rows[row];
				if (!entry?.row) return;
				const next = { block: block.key, key: entry.row.key, column };
				if (
					next.block === selected?.block &&
					next.key === selected?.key &&
					next.column === selected?.column
				) {
					return;
				}
				selected = next;
				onselect?.(next);
			},
		};
	}

	function renderCell(
		block: SheetBlock,
		rows: Entry[],
		td: HTMLTableCellElement,
		gridRow: number,
		column: number,
		value: unknown,
	) {
		td.classList.remove(...CLASSES);
		td.replaceChildren();
		td.removeAttribute('title');
		td.removeAttribute('data-sheet-row');
		td.removeAttribute('data-sheet-column');
		const entry = rows[gridRow];
		const text = value == null ? '' : String(value);
		td.textContent = text;
		if (!entry) return td;
		if (!entry.row) {
			td.classList.add('sheet-band');
			return td;
		}
		const row = entry.row;
		td.setAttribute('data-sheet-row', row.key);
		td.setAttribute('data-sheet-column', String(column));
		if (column > 0) td.classList.add('htRight', 'htNumeric');
		if (row.unused) {
			td.classList.add('sheet-unused');
			td.title = 'read by no formula yet; not kept by the save';
		}
		if (stale && row.code) td.classList.add('sheet-stale');
		if (row.key !== selected?.key) {
			if (reads.has(row.key)) td.classList.add('sheet-reads');
			else if (readBy.has(row.key)) td.classList.add('sheet-read-by');
		}
		const cell = row.cells[column - 1];
		if (column === 0 && row.note) td.title = row.note;
		if (column > 0 && cell?.skipped) td.title = cell.skipped;
		if (column > 0 && row.code && cell && !cell.skipped) {
			const read = contributors(trace, row.code, block.columns.length > 0 ? column - 1 : null);
			if (read.length > 0) {
				td.title = read.map((c) => `${c.name} = ${fmt(c.value)}`).join(', ');
			}
		}
		return td;
	}

	// What the renderer reads beyond its own row: repainting is driven by this, not by the
	// selection object, so a repaint that re-emits the same cell does not schedule another.
	const highlight = $derived(
		`${selected?.key ?? ''}|${[...reads].join(',')}|${[...readBy].join(',')}|${stale}`,
	);

	// The renderer reads the selection, so a selection anywhere repaints every block. Repainting
	// rather than re-settling the grid keeps the selection Handsontable itself holds. Only one
	// table holds it: the others are cleared, so a cell stays selected where it was clicked.
	const grids = new Map<string, HotInstance>();
	let repainting = false;
	function ready(block: SheetBlock, instance: HotInstance) {
		grids.set(block.key, instance);
		instance.addHook('afterRender', () => queueMicrotask(redraw));
		queueMicrotask(redraw);
	}

	// --- Dropping a palette entry ---
	// The whole block takes the drop, not its table: a block with no rows mounts no table, and it
	// is where the first input is expected to go.

	function dragover(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	/** The row the pointer is over, or null when it is over the block but not a row. */
	function rowUnder(block: SheetBlock, target: HTMLElement | null): SheetRow | null {
		const instance = grids.get(block.key);
		const td = target?.closest('td') ?? null;
		if (!instance || instance.isDestroyed || !td) return null;
		const index = instance.getCoords(td)?.row ?? -1;
		return index >= 0 ? ((entries.get(block.key) ?? [])[index]?.row ?? null) : null;
	}

	function dropped(block: SheetBlock, event: DragEvent) {
		if (!ondrop) return;
		const text = event.dataTransfer?.getData('text/plain');
		if (!text) return;
		event.preventDefault();
		let payload: DragPayload;
		try {
			payload = JSON.parse(text) as DragPayload;
		} catch {
			return;
		}
		const row = rowUnder(block, event.target as HTMLElement | null);
		if (dropOn(block.key, row)) ondrop(block.key, row, payload);
	}
	$effect(() => {
		void highlight;
		repainting = true;
		for (const [key, instance] of grids) {
			if (instance.isDestroyed) continue;
			if (key !== selected?.block) instance.deselectCell();
			instance.render();
		}
		repainting = false;
		redraw();
	});

	const gridSettings = $derived(new Map(blocks.map((b) => [b.key, settingsOf(b)])));

	// --- Lines from the selected cell to the cells it reads ---
	// The tables are three grids of their own, so a link between them is drawn over the lot rather
	// than inside one. Handsontable draws only the rows in view, so a source that is scrolled out
	// has no cell to draw to and is named instead.

	/** One line, in the coordinates of the surface the tables are laid out on. */
	interface Edge {
		key: string;
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}

	let surface = $state<HTMLDivElement | null>(null);
	let edges = $state<Edge[]>([]);
	let offscreen = $state<string[]>([]);

	/** Where a row sits: its label cell, and the table holding it. */
	function anchorOf(key: string): { cell: HTMLElement | null; block: string; row: number } | null {
		for (const block of blocks) {
			const index = (entries.get(block.key) ?? []).findIndex((e) => e.row?.key === key);
			if (index < 0) continue;
			const grid = grids.get(block.key);
			const cell =
				grid && !grid.isDestroyed ? ((grid.getCell(index, 0) as HTMLElement | null) ?? null) : null;
			return { cell, block: block.key, row: index };
		}
		return null;
	}

	function redraw() {
		const box = surface?.getBoundingClientRect();
		const target = selected ? anchorOf(selected.key)?.cell : null;
		if (!box || !target) {
			edges = [];
			offscreen = [];
			return;
		}
		const to = target.getBoundingClientRect();
		const drawn: Edge[] = [];
		const missing: string[] = [];
		for (const key of reads) {
			if (key === selected?.key) continue;
			const anchor = anchorOf(key);
			if (!anchor) continue;
			if (!anchor.cell) {
				missing.push(key);
				continue;
			}
			const from = anchor.cell.getBoundingClientRect();
			drawn.push({
				key,
				x1: from.right - box.left,
				y1: from.top + from.height / 2 - box.top,
				x2: to.left - box.left,
				y2: to.top + to.height / 2 - box.top,
			});
		}
		edges = drawn;
		offscreen = missing;
	}

	/** Bring a source that is scrolled out of its table into view. */
	function reveal(key: string) {
		const anchor = anchorOf(key);
		if (!anchor) return;
		grids.get(anchor.block)?.scrollViewportTo({ row: anchor.row });
		redraw();
	}
</script>

<svelte:window onscroll={redraw} onresize={redraw} />

<div class="relative" bind:this={surface}>
	{#if edges.length > 0}
		<svg class="pointer-events-none absolute inset-0 h-full w-full z-10" aria-hidden="true">
			{#each edges as edge (edge.key)}
				<line
					x1={edge.x1}
					y1={edge.y1}
					x2={edge.x2}
					y2={edge.y2}
					class="sheet-edge"
					data-sheet-edge={edge.key}
				/>
			{/each}
		</svg>
	{/if}
	<div class="grid gap-3 lg:grid-cols-3 items-start">
	{#each blocks as block (block.key)}
		<section
			aria-label={block.title}
			class="min-w-0 rounded-md border border-brand-divider bg-brand-surface"
			ondragover={ondrop ? dragover : undefined}
			ondrop={ondrop ? (event) => dropped(block, event) : undefined}
		>
			{#if block.rows.length === 0}
				<h4 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">{block.title}</h4>
				<p class="px-3 py-3 text-sm text-brand-muted">
					{block.key === 'inputs'
						? ondrop
							? 'Drop a parameter or constant here, or write a formula that reads one.'
							: 'Nothing read yet.'
						: block.key === 'steps'
							? 'No steps: every formula publishes.'
							: 'Nothing published yet.'}
				</p>
			{:else}
				<SheetGrid
					data={dataOf(block)}
					settings={gridSettings.get(block.key)!}
					onready={(instance) => ready(block, instance)}
					class="text-sm"
				/>
			{/if}
			{#if block.key === 'inputs' && block.rows.some((r) => r.unused)}
				<p class="px-3 py-1 text-[11px] text-brand-muted">
					An outlined row is read by no formula yet, and the save does not keep it.
				</p>
			{/if}
			{#if onadd && block.key !== 'inputs'}
				<div class="px-3 py-2">
					<Button size="sm" variant="ghost" onclick={() => onadd(block.key as 'steps' | 'outputs')}>
						{block.key === 'steps' ? 'Add step' : 'Add output'}
					</Button>
				</div>
			{/if}
		</section>
	{/each}
	</div>
	{#if offscreen.length > 0}
		<p class="mt-1 text-[11px] text-brand-muted">
			Read from out of view:
			{#each offscreen as key (key)}
				<button
					type="button"
					class="ml-1 font-mono text-brand-primary bg-transparent border-none p-0 cursor-pointer hover:underline"
					onclick={() => reveal(key)}>{key}</button>
			{/each}
		</p>
	{/if}
</div>
