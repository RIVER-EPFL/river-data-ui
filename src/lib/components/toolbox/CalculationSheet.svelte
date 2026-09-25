<script lang="ts">
	import type { CellProperties, GridSettings, HotInstance } from 'handsontable';
	import type { RunTraceStep } from '$api/service';
	import type { EditableFormula } from '$lib/calculations/editor';
	import { tick } from 'svelte';
	import {
		arrangedBlocks,
		blockOrder,
		cellEdit,
		contributors,
		dropOn,
		edgeColumn,
		emptyBlockLine,
		formulaOf,
		gridColumnOf,
		gridColumnRole,
		gridHeaders,
		isFolded,
		linksOf,
		movedBlock,
		neighbourBlock,
		replicateStatistics,
		STATISTIC_COLUMNS,
		rowRemoval,
		visibleColumn,
		type BlockView,
		type RowRemoval,
		type SheetBlock,
		type SheetEdit,
		type SheetRow,
		type SheetSelection,
	} from '$lib/calculations/sheet';
	import { readPayload, type DragPayload } from '$components/formula/ast';
	import Button from '$components/ui/Button.svelte';
	import { identifiers } from '$lib/formula/lint';
	import { REPLICATE_MARK_SVG, REPLICATE_MARK_TITLE } from '$lib/calculations/replicateMark';
	import SheetGrid from '$components/ui/SheetGrid.svelte';
	import { headroom, routeLinks, type LinkEnds, type Rect, type Route } from '$lib/calculations/route';

	// The portal's tables, side by side: what the visit and the catalog supplied, the steps of the
	// calculation where it has any, and what it publishes with the statistics of the repeats.
	// Parameters go down and replicates across, so a set reads the way the lab writes it down. Each
	// table opens folded to the label, mean and sd; its header opens the replicate columns.
	//
	// Selecting a cell lights what its row reads and what reads it, across all three tables. The
	// author may move a table by the grip in its header; the order is kept per browser.

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
		/** Remove a row. Without it the rows carry no remove control. */
		onremove?: (removal: RowRemoval) => void;
		/** The inputs brought in by hand, which are the only inputs a remove takes out. */
		declared?: string[];
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
		onremove,
		declared = [],
	}: Props = $props();

	// --- Removing a row ---
	// A removal the author may regret waits on a confirm under the tables; one that only takes out
	// what nothing reads happens at once, since the save is what makes it stick.

	let asking = $state<{ removal: RowRemoval; message: string } | null>(null);
	let removeRefused = $state<string | null>(null);

	function askRemove(removal: RowRemoval) {
		removeRefused = null;
		asking = null;
		if (removal.kind === 'refused') {
			removeRefused = removal.reason;
		} else if (removal.kind === 'stop-reading') {
			asking = {
				removal,
				message: `Stop reading ${removal.key} in this calculation? The step itself stays.`,
			};
		} else if (removal.kind === 'formula' && removal.readers.length > 0) {
			const verb = removal.readers.length === 1 ? 'reads' : 'read';
			asking = {
				removal,
				message: `Drop ${removal.key}? ${removal.readers.join(', ')} still ${verb} it. The save deletes it.`,
			};
		} else {
			onremove?.(removal);
		}
	}

	function confirmRemove() {
		if (asking) onremove?.(asking.removal);
		asking = null;
	}

	function removeButton(row: SheetRow, removal: RowRemoval): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'sheet-remove';
		button.textContent = '×';
		button.setAttribute('aria-label', `Remove ${row.label}`);
		button.title =
			removal.kind === 'refused'
				? removal.reason
				: removal.kind === 'stop-reading'
					? 'Stop reading this step here'
					: 'Remove';
		// The grid selects and edits on mousedown, so the press never reaches it.
		button.addEventListener('mousedown', (event) => event.stopPropagation());
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			askRemove(removal);
		});
		return button;
	}

	function fmt(value: number | null): string {
		if (value === null) return '';
		return Number.isInteger(value) ? String(value) : value.toPrecision(6);
	}

	// --- Arranging the tables ---

	const ORDER_KEY = 'calculation-sheet-order';
	const BLOCK_TYPE = 'application/x-sheet-block';
	let order = $state(storedOrder());
	const arranged = $derived(arrangedBlocks(blocks, order));

	function storedOrder() {
		try {
			return blockOrder(localStorage.getItem(ORDER_KEY));
		} catch {
			return blockOrder(null);
		}
	}

	async function move(key: SheetBlock['key'], onto: SheetBlock['key'] | null) {
		if (!onto) return;
		order = movedBlock(order, key, onto);
		try {
			localStorage.setItem(ORDER_KEY, JSON.stringify(order));
		} catch {
			// The order holds for this visit to the page.
		}
		await tick();
		redraw();
	}

	/** The handle a table is dragged by, or stepped along with the arrow keys. */
	function grip(block: SheetBlock): HTMLElement {
		const handle = document.createElement('span');
		handle.className = 'sheet-grip';
		handle.textContent = '⠿';
		handle.draggable = true;
		handle.tabIndex = 0;
		handle.setAttribute('role', 'button');
		handle.setAttribute('aria-label', `Move the ${block.title} table`);
		handle.title = 'Drag to move the table, or use the arrow keys';
		handle.addEventListener('mousedown', (event) => event.stopPropagation());
		handle.addEventListener('dragstart', (event) => startMove(block, event));
		handle.addEventListener('keydown', (event) => stepMove(block, event));
		return handle;
	}

	function startMove(block: SheetBlock, event: DragEvent) {
		event.stopPropagation();
		event.dataTransfer?.setData(BLOCK_TYPE, block.key);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function stepMove(block: SheetBlock, event: KeyboardEvent) {
		const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
		if (!step) return;
		event.preventDefault();
		event.stopPropagation();
		const shown = arranged.map((b) => b.key);
		move(block.key, neighbourBlock(shown, block.key, step));
	}

	function isMove(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes(BLOCK_TYPE) ?? false;
	}

	// --- Folding the replicate columns ---

	let opened = $state<Set<string>>(new Set());

	function viewOf(block: SheetBlock): BlockView {
		return { columns: block.columns, folded: !opened.has(block.key) };
	}

	function toggleOpened(key: string) {
		const next = new Set(opened);
		if (!next.delete(key)) next.add(key);
		opened = next;
	}

	/** The title header's grip that moves the table, and the control that folds its replicates. */
	function titleHeader(block: SheetBlock, column: number, th: HTMLTableCellElement) {
		if (column !== 0) return;
		const label = th.querySelector('.colHeader');
		if (!label) return;
		th.setAttribute('aria-label', block.title);
		if (!label.querySelector('.sheet-grip')) label.prepend(grip(block));
		label.querySelector('.sheet-header-button')?.remove();
		if (block.columns.length === 0) return;
		const folded = isFolded(viewOf(block));
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'sheet-header-button';
		const action = folded ? `Open the ${block.title} replicates` : `Fold the ${block.title} replicates`;
		button.textContent = folded ? '+' : '−';
		button.title = action;
		button.setAttribute('aria-expanded', String(!folded));
		button.setAttribute('aria-label', action);
		button.addEventListener('mousedown', (event) => event.stopPropagation());
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			toggleOpened(block.key);
		});
		label.append(' ', button);
	}

	/** A replicated row's avg and sd, ahead of its replicates; blank on a row with one number. */
	function statisticsOf(block: SheetBlock, row: SheetRow): string[] {
		if (block.columns.length === 0) return [];
		if (!row.replicated) return STATISTIC_COLUMNS.map(() => '');
		const stats = replicateStatistics(row.cells.slice(0, block.columns.length));
		return [fmt(stats.mean), fmt(stats.sd)];
	}

	function dataOf(block: SheetBlock): string[][] {
		const width = Math.max(1, block.columns.length);
		const folded = isFolded(viewOf(block));
		return block.rows.map((row) => {
			const values = row.cells.slice(0, width).map((c) => (c.skipped ? '—' : fmt(c.value)));
			if (folded && !row.replicated) return [row.label, values[0] ?? '', ''];
			if (folded) return [row.label, ...statisticsOf(block, row)];
			return [row.label, ...statisticsOf(block, row), ...values];
		});
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
	// What reads the selected row: the formulas naming its code, or naming the input it holds.
	const readBy = $derived(
		new Set(
			selectedRow && selectedRow.band !== 'statistics'
				? linksOf(formulas, selectedRow.code ?? selectedRow.key).readBy
				: [],
		),
	);

	const CLASSES = [
		'htRight',
		'htNumeric',
		'sheet-reads',
		'sheet-read-by',
		'sheet-unused',
		'sheet-stale',
		'sheet-removable',
		'sheet-typed',
		'sheet-statistic',
	];

	/** The selection's column for a grid column: the label, a replicate, or null on a statistic. */
	function columnOf(block: SheetBlock, gridColumn: number, row: SheetRow | null): number | null {
		const role = gridColumnRole(viewOf(block), gridColumn, row?.replicated ?? true);
		return role.kind === 'label' ? 0 : role.kind === 'value' ? role.column : null;
	}

	/** What a cell would do if it were typed into, which is also what makes it writable. */
	function editOf(
		block: SheetBlock,
		row: SheetRow | null,
		gridColumn: number,
		text: string,
	): SheetEdit | null {
		const column = columnOf(block, gridColumn, row);
		return row && onedit && column !== null ? cellEdit(row, column, text) : null;
	}

	function settingsOf(block: SheetBlock): Omit<GridSettings, 'data' | 'licenseKey' | 'themeName'> {
		const rows = block.rows;
		return {
			colHeaders: [block.title, ...gridHeaders(viewOf(block))],
			afterGetColHeader: (column: number, th: HTMLTableCellElement) => titleHeader(block, column, th),
			rowHeaders: false,
			wordWrap: false,
			width: '100%',
			height: 'auto',
			// The least a table takes; the blocks sit side by side only where each gets this much.
			colWidths: (index: number) => (index === 0 ? 120 : 72),
			stretchH: 'all',
			manualColumnResize: true,
			fillHandle: false,
			outsideClickDeselects: false,
			cells: (row: number, column: number) => ({
				readOnly: !editOf(block, rows[row] ?? null, column, ''),
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
						block,
						rows[row] ?? null,
						Number(prop),
						next == null ? '' : String(next),
					);
					if (edit) onedit?.(edit);
				}
			},
			// A repaint re-emits each grid's own selection, which is not written back, or the table
			// last clicked would take the selection from the new one. It is taken once the press is
			// released: the panel above the tables reshapes on a new selection, and a table moved
			// under a press reads its release as a click outside and stops taking keys.
			afterSelectionEnd: (row: number, gridColumn: number) => {
				// Only the table the person is working in speaks: the others re-emit what they still
				// hold whenever they are drawn.
				if (repainting || grids.get(block.key)?.isListening() === false) return;
				const entry = rows[row];
				if (!entry) return;
				const next = { block: block.key, key: entry.key, column: columnOf(block, gridColumn, entry) ?? 0 };
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
		rows: SheetRow[],
		td: HTMLTableCellElement,
		gridRow: number,
		gridColumn: number,
		value: unknown,
	) {
		td.classList.remove(...CLASSES);
		td.replaceChildren();
		td.removeAttribute('title');
		td.removeAttribute('data-sheet-row');
		td.removeAttribute('data-sheet-column');
		td.removeAttribute('data-sheet-statistic');
		const row = rows[gridRow];
		const text = value == null ? '' : String(value);
		td.textContent = text;
		if (!row) return td;
		td.setAttribute('data-sheet-row', row.key);
		const role = gridColumnRole(viewOf(block), gridColumn, row.replicated);
		if (role.kind === 'statistic') {
			td.setAttribute('data-sheet-statistic', role.statistic);
			td.classList.add('htRight', 'htNumeric', 'sheet-statistic');
			if (row.replicated) {
				td.title =
					role.statistic === 'avg'
						? 'mean of the replicates'
						: 'sample standard deviation (n - 1) of the replicates';
			}
			return td;
		}
		const column = role.kind === 'label' ? 0 : role.column;
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
		if (column === 0 && row.tag) {
			const tag = document.createElement('span');
			tag.className = 'sheet-tag';
			tag.textContent = row.tag;
			td.append(tag);
		}
		if (column === 0 && row.optional) {
			const tag = document.createElement('span');
			tag.className = 'sheet-tag';
			tag.textContent = 'optional';
			tag.title = 'read only through a guard such as coalesce; a visit without it still runs';
			td.append(tag);
		}
		if (column === 0 && row.replicated) {
			const mark = document.createElement('span');
			mark.className = 'sheet-replicated';
			mark.title = REPLICATE_MARK_TITLE;
			mark.setAttribute('role', 'img');
			mark.setAttribute('aria-label', REPLICATE_MARK_TITLE);
			mark.innerHTML = REPLICATE_MARK_SVG;
			td.append(mark);
		}
		const formula = column === 0 ? formulaOf(row) : null;
		if (formula) {
			const line = document.createElement('span');
			line.className = 'sheet-formula';
			line.textContent = formula;
			td.append(line);
		}
		const removal = column === 0 && onremove ? rowRemoval(row, formulas, declared) : null;
		if (removal) {
			td.classList.add('sheet-removable');
			td.append(removeButton(row, removal));
		}
		if (column > 0 && cell?.skipped) td.title = cell.skipped;
		if (column > 0 && cell?.typed) {
			td.classList.add('sheet-typed');
			td.title = 'typed; clear the cell to read the stored value';
		}
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
		if (!isMove(event) && !ondrop) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = isMove(event) ? 'move' : 'copy';
	}

	/** The row the pointer is over, or null when it is over the block but not a row. */
	function rowUnder(block: SheetBlock, target: HTMLElement | null): SheetRow | null {
		const instance = grids.get(block.key);
		const td = target?.closest('td') ?? null;
		if (!instance || instance.isDestroyed || !td) return null;
		const index = instance.getCoords(td)?.row ?? -1;
		return index >= 0 ? (block.rows[index] ?? null) : null;
	}

	function dropped(block: SheetBlock, event: DragEvent) {
		if (isMove(event)) {
			event.preventDefault();
			move(event.dataTransfer!.getData(BLOCK_TYPE) as SheetBlock['key'], block.key);
			return;
		}
		if (!ondrop) return;
		const payload = readPayload(event.dataTransfer);
		if (!payload) return;
		event.preventDefault();
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

	// --- Lines from the selected cell to the cells it reads and the cells reading it ---
	// The tables are three grids of their own, so a link between them is drawn over the lot rather
	// than inside one, routed through the gutters around them. Handsontable draws only the rows in
	// view, so a row that is scrolled out has no cell to draw to and is named instead.

	type Direction = 'reads' | 'read-by';

	/** A routed link, and which way it runs from the selected row. */
	interface Edge extends Route {
		direction: Direction;
		name: string;
	}

	let surface = $state<HTMLDivElement | null>(null);
	let edges = $state<Edge[]>([]);
	let offscreen = $state<string[]>([]);
	const lanesAbove = $derived(headroom(edges));

	/** Where a row sits: the cell a line meets it at, and the table holding it. */
	function anchorOf(
		key: string,
		end: 'source' | 'reader',
	): { cell: HTMLElement | null; block: string; row: number } | null {
		for (const block of blocks) {
			const index = block.rows.findIndex((r) => r.key === key);
			if (index < 0) continue;
			const grid = grids.get(block.key);
			if (!grid || grid.isDestroyed) return { cell: null, block: block.key, row: index };
			const cellAt = (column: number) =>
				(grid.getCell(index, gridColumnOf(viewOf(block), column)) as HTMLElement | null) ?? null;
			// A column scrolled out of the table's width is not the row's edge, so fall back to one in view.
			const column = visibleColumn(
				edgeColumn(end, block.columns.length),
				(c) => cellAt(c)?.getBoundingClientRect() ?? null,
				grid.rootElement.getBoundingClientRect(),
			);
			return { cell: column === null ? null : cellAt(column), block: block.key, row: index };
		}
		return null;
	}

	function redraw() {
		const box = surface?.getBoundingClientRect();
		const target = selected ? anchorOf(selected.key, 'reader') : null;
		if (!box || !target?.cell) {
			edges = [];
			offscreen = [];
			return;
		}
		const middle = (cell: HTMLElement) => {
			const r = cell.getBoundingClientRect();
			return r.top + r.height / 2 - box.top;
		};
		const tables = blocks.map((b): Rect => {
			const r = surface!.querySelector(`section[data-block="${b.key}"]`)?.getBoundingClientRect();
			return r
				? { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top }
				: { left: 0, top: 0, right: 0, bottom: 0 };
		});
		const tableOf = (block: string) => blocks.findIndex((b) => b.key === block);
		const own = selected ? anchorOf(selected.key, 'source') : null;
		const links: LinkEnds[] = [];
		const directions: Direction[] = [];
		const names: string[] = [];
		const missing: string[] = [];
		const link = (key: string, direction: Direction) => {
			if (key === selected?.key) return;
			const anchor = anchorOf(key, direction === 'reads' ? 'source' : 'reader');
			const from = direction === 'reads' ? anchor : own;
			const to = direction === 'reads' ? target : anchor;
			if (!anchor || !from || !to) return;
			if (!anchor.cell || !from.cell || !to.cell) {
				if (!missing.includes(key)) missing.push(key);
				return;
			}
			// A link runs from what is read to what reads it, and names what is read, beside the
			// row it concerns so the labels of one selection never share a row.
			links.push({
				key: `${direction}:${key}`,
				label: from === own ? selected!.key : key,
				from: { table: tableOf(from.block), y: middle(from.cell) },
				to: { table: tableOf(to.block), y: middle(to.cell) },
				labelAt: direction === 'reads' ? 'from' : 'to',
			});
			directions.push(direction);
			names.push(key);
		};
		for (const key of reads) link(key, 'reads');
		for (const key of readBy) link(key, 'read-by');
		edges = routeLinks(tables, box.width, links).map((route, i) => ({
			...route,
			direction: directions[i]!,
			name: names[i]!,
		}));
		offscreen = missing;
	}

	// The tables move with whatever is laid out around them, and wrap as the page narrows, so a
	// line is measured again whenever the surface or a table changes size.
	$effect(() => {
		if (!surface) return;
		const observer = new ResizeObserver(() => redraw());
		observer.observe(surface);
		for (const key of blocks.map((b) => b.key)) {
			const table = surface.querySelector(`section[data-block="${key}"]`);
			if (table) observer.observe(table);
		}
		return () => observer.disconnect();
	});

	/** Bring a source that is scrolled out of its table into view. */
	function reveal(key: string) {
		const anchor = anchorOf(key, 'source');
		if (!anchor) return;
		grids.get(anchor.block)?.scrollViewportTo({ row: anchor.row });
		redraw();
	}
</script>

<svelte:window onscroll={redraw} onresize={redraw} />

<div class="@container relative" bind:this={surface}>
	{#if edges.length > 0}
		<svg class="pointer-events-none absolute inset-0 h-full w-full z-10" aria-hidden="true">
			<defs>
				{#each ['reads', 'read-by'] as direction (direction)}
					<marker
						id="sheet-arrow-{direction}"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="5"
						markerHeight="5"
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 10 5 L 0 10 z" class="sheet-edge-arrow" class:sheet-edge-read-by={direction === 'read-by'} />
					</marker>
				{/each}
			</defs>
			{#each edges as edge (edge.key)}
				<path
					d={edge.path}
					class="sheet-edge"
					class:sheet-edge-read-by={edge.direction === 'read-by'}
					marker-end="url(#sheet-arrow-{edge.direction})"
					data-sheet-edge={edge.name}
					data-sheet-edge-direction={edge.direction}
				/>
				<text
					x={edge.label.x}
					y={edge.label.y}
					text-anchor={edge.label.anchor}
					class="sheet-edge-label"
					class:sheet-edge-read-by={edge.direction === 'read-by'}>{edge.label.text}</text
				>
			{/each}
		</svg>
	{/if}
	<!-- The gutters, and the room above the tables while a link goes over them, hold its lanes. -->
	<div
		class="grid gap-3 @6xl:gap-x-24 items-start @md:grid-cols-2 @2xl:grid-cols-3"
		style="padding-top: {lanesAbove}px"
		data-sheet-headroom={lanesAbove}
	>
	{#each arranged as block (block.key)}
		<section
			aria-label={block.title}
			data-block={block.key}
			class="min-w-0 rounded-md border border-brand-divider bg-brand-surface"
			ondragover={dragover}
			ondrop={(event) => dropped(block, event)}
		>
			{#if block.rows.length === 0}
				<h4 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">
					<span
						class="sheet-grip"
						role="button"
						tabindex="0"
						draggable="true"
						aria-label="Move the {block.title} table"
						title="Drag to move the table, or use the arrow keys"
						ondragstart={(event) => startMove(block, event)}
						onkeydown={(event) => stepMove(block, event)}>⠿</span>
					{block.title}
				</h4>
				<p class="px-3 py-3 text-sm text-brand-muted">{emptyBlockLine(block.key, Boolean(ondrop))}</p>
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
				<div class="flex flex-wrap gap-2 px-3 py-2">
					<Button size="sm" variant="ghost" onclick={() => onadd(block.key as 'steps' | 'outputs')}>
						{block.key === 'steps' ? 'Add step' : 'Add output'}
					</Button>
				</div>
			{/if}
		</section>
	{/each}
	</div>
	{#if asking}
		<div role="alertdialog" aria-label="Confirm removal" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
			<span>{asking.message}</span>
			<Button size="sm" variant="danger" onclick={confirmRemove}>
				{asking.removal.kind === 'stop-reading' ? 'Stop reading' : 'Drop'}
			</Button>
			<Button size="sm" variant="ghost" onclick={() => (asking = null)}>Keep</Button>
		</div>
	{/if}
	{#if removeRefused}
		<p role="status" class="mt-2 text-xs text-severity-alarm">{removeRefused}</p>
	{/if}
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
