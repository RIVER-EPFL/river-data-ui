<script lang="ts">
	import type { CellProperties, GridSettings, HotInstance } from 'handsontable';
	import type { RunTraceStep } from '$api/service';
	import type { EditableFormula } from '$lib/calculations/editor';
	import {
		cellEdit,
		contributors,
		dropOn,
		edgeColumn,
		emptyBlockLine,
		formulaOf,
		gridColumnOf,
		gridColumnRole,
		linksOf,
		replicateStatistics,
		STATISTIC_COLUMNS,
		rowRemoval,
		stepsOffRefusal,
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

	// The portal's tables, side by side: what the visit and the catalog supplied, the steps of the
	// calculation where it has any, and what it publishes with the statistics of the repeats.
	// Parameters go down and replicate letters across, so a set reads the way the lab writes it down.
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
		/** Turn the steps block on or off. Without it the sheet carries no switch. */
		onsteps?: (on: boolean) => void;
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
		onsteps,
		onremove,
		declared = [],
	}: Props = $props();

	const showingSteps = $derived(blocks.some((b) => b.key === 'steps'));
	let stepsRefused = $state<string | null>(null);

	function toggleSteps(event: Event) {
		const box = event.currentTarget as HTMLInputElement;
		if (box.checked) {
			stepsRefused = null;
			onsteps?.(true);
			return;
		}
		stepsRefused = stepsOffRefusal(formulas);
		if (stepsRefused) {
			box.checked = true;
			return;
		}
		onsteps?.(false);
	}

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

	/** A replicated row's avg and sd, ahead of its letters; blank on a row with one number. */
	function statisticsOf(block: SheetBlock, row: SheetRow): string[] {
		if (block.columns.length === 0) return [];
		if (!row.replicated) return STATISTIC_COLUMNS.map(() => '');
		const stats = replicateStatistics(row.cells.slice(0, block.columns.length));
		return [fmt(stats.mean), fmt(stats.sd)];
	}

	function dataOf(block: SheetBlock): string[][] {
		const width = Math.max(1, block.columns.length);
		return block.rows.map((row) => [
			row.label,
			...statisticsOf(block, row),
			...row.cells.slice(0, width).map((c) => (c.skipped ? '—' : fmt(c.value))),
		]);
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
	function columnOf(block: SheetBlock, gridColumn: number): number | null {
		const role = gridColumnRole(block, gridColumn);
		return role.kind === 'label' ? 0 : role.kind === 'value' ? role.column : null;
	}

	/** What a cell would do if it were typed into, which is also what makes it writable. */
	function editOf(
		block: SheetBlock,
		row: SheetRow | null,
		gridColumn: number,
		text: string,
	): SheetEdit | null {
		const column = columnOf(block, gridColumn);
		return row && onedit && column !== null ? cellEdit(row, column, text) : null;
	}

	function settingsOf(block: SheetBlock): Omit<GridSettings, 'data' | 'licenseKey' | 'themeName'> {
		const rows = block.rows;
		return {
			colHeaders: [
				block.title,
				...(block.columns.length > 0 ? [...STATISTIC_COLUMNS, ...block.columns] : ['Value']),
			],
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
			// last clicked would take the selection from the new one.
			afterSelection: (row: number, gridColumn: number) => {
				// Only the table the person is working in speaks: the others re-emit what they still
				// hold whenever they are drawn.
				if (repainting || grids.get(block.key)?.isListening() === false) return;
				const entry = rows[row];
				if (!entry) return;
				const next = { block: block.key, key: entry.key, column: columnOf(block, gridColumn) ?? 0 };
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
		const role = gridColumnRole(block, gridColumn);
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
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
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
	// than inside one. Handsontable draws only the rows in view, so a source that is scrolled out
	// has no cell to draw to and is named instead.

	/** One line, in the coordinates of the surface the tables are laid out on. */
	interface Edge {
		key: string;
		direction: 'reads' | 'read-by';
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	}

	let surface = $state<HTMLDivElement | null>(null);
	let edges = $state<Edge[]>([]);
	let offscreen = $state<string[]>([]);

	/** Where a row sits: the cell a line meets it at, and the table holding it. */
	function anchorOf(
		key: string,
		end: 'source' | 'reader',
	): { cell: HTMLElement | null; block: string; row: number } | null {
		for (const block of blocks) {
			const index = block.rows.findIndex((r) => r.key === key);
			if (index < 0) continue;
			const grid = grids.get(block.key);
			let cell: HTMLElement | null = null;
			// A column scrolled out of the table has no cell, so fall back to the last one drawn.
			for (let column = edgeColumn(end, block.columns.length); column >= 0 && !cell; column--) {
				if (grid && !grid.isDestroyed) {
					cell = (grid.getCell(index, gridColumnOf(block, column)) as HTMLElement | null) ?? null;
				}
			}
			return { cell, block: block.key, row: index };
		}
		return null;
	}

	/** The selected row's cell a line to its readers leaves from. */
	function selectedSource(): HTMLElement | null {
		return selected ? (anchorOf(selected.key, 'source')?.cell ?? null) : null;
	}

	function redraw() {
		const box = surface?.getBoundingClientRect();
		const target = selected ? anchorOf(selected.key, 'reader')?.cell : null;
		if (!box || !target) {
			edges = [];
			offscreen = [];
			return;
		}
		const drawn: Edge[] = [];
		const missing: string[] = [];
		const link = (key: string, direction: Edge['direction']) => {
			if (key === selected?.key) return;
			const anchor = anchorOf(key, direction === 'reads' ? 'source' : 'reader');
			if (!anchor) return;
			if (!anchor.cell) {
				if (!missing.includes(key)) missing.push(key);
				return;
			}
			// A line runs from what is read, on its right, to what reads it, on its left.
			const [from, to] =
				direction === 'reads'
					? [anchor.cell.getBoundingClientRect(), target.getBoundingClientRect()]
					: [selectedSource()!.getBoundingClientRect(), anchor.cell.getBoundingClientRect()];
			drawn.push({
				key,
				direction,
				x1: from.right - box.left,
				y1: from.top + from.height / 2 - box.top,
				x2: to.left - box.left,
				y2: to.top + to.height / 2 - box.top,
			});
		};
		for (const key of reads) link(key, 'reads');
		if (readBy.size > 0 && selectedSource()) for (const key of readBy) link(key, 'read-by');
		edges = drawn;
		offscreen = missing;
	}

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
			{#each edges as edge (`${edge.direction}:${edge.key}`)}
				<line
					x1={edge.x1}
					y1={edge.y1}
					x2={edge.x2}
					y2={edge.y2}
					class="sheet-edge"
					class:sheet-edge-read-by={edge.direction === 'read-by'}
					data-sheet-edge={edge.key}
					data-sheet-edge-direction={edge.direction}
				/>
			{/each}
		</svg>
	{/if}
	{#if onsteps}
		<div class="mb-2 flex flex-wrap items-center gap-3 text-xs text-brand-muted">
			<label class="inline-flex items-center gap-1.5">
				<input type="checkbox" checked={showingSteps} onchange={toggleSteps} />
				Intermediate steps
			</label>
			{#if stepsRefused}
				<span role="status" class="text-severity-alarm">{stepsRefused}</span>
			{/if}
		</div>
	{/if}
	<div class="grid gap-3 items-start @md:grid-cols-2 {blocks.length === 3 ? '@2xl:grid-cols-3' : ''}">
	{#each blocks as block (block.key)}
		<section
			aria-label={block.title}
			class="min-w-0 rounded-md border border-brand-divider bg-brand-surface"
			ondragover={ondrop ? dragover : undefined}
			ondrop={ondrop ? (event) => dropped(block, event) : undefined}
		>
			{#if block.rows.length === 0}
				<h4 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">{block.title}</h4>
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
					{#if block.key === 'outputs' && !showingSteps}
						<Button size="sm" variant="ghost" onclick={() => onadd('steps')}>Add step</Button>
					{/if}
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
