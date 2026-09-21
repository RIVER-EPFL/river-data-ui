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
			afterSelection: (row: number, column: number) => {
				const entry = rows[row];
				const next = entry?.row ? { block: block.key, key: entry.row.key, column } : null;
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

	// The renderer reads the selection, so a selection anywhere repaints every block. Repainting
	// rather than re-settling the grid keeps the selection Handsontable itself holds.
	const grids = new Map<string, HotInstance>();
	function ready(block: SheetBlock, instance: HotInstance) {
		grids.set(block.key, instance);
		if (!ondrop) return;
		instance.rootElement.addEventListener('dragover', (event: DragEvent) => {
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		});
		instance.rootElement.addEventListener('drop', (event: DragEvent) => {
			const text = event.dataTransfer?.getData('text/plain');
			if (!text) return;
			event.preventDefault();
			let payload: DragPayload;
			try {
				payload = JSON.parse(text) as DragPayload;
			} catch {
				return;
			}
			const td = (event.target as HTMLElement).closest('td');
			const at = td ? instance.getCoords(td) : null;
			const index = at?.row ?? -1;
			const row = index >= 0 ? ((entries.get(block.key) ?? [])[index]?.row ?? null) : null;
			if (dropOn(block.key, row)) ondrop(block.key, row, payload);
		});
	}
	$effect(() => {
		void selected;
		for (const instance of grids.values()) if (!instance.isDestroyed) instance.render();
	});

	const gridSettings = $derived(new Map(blocks.map((b) => [b.key, settingsOf(b)])));
</script>

<div class="grid gap-3 lg:grid-cols-3 items-start">
	{#each blocks as block (block.key)}
		<section class="min-w-0 rounded-md border border-brand-divider bg-brand-surface">
			{#if block.rows.length === 0}
				<h4 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">{block.title}</h4>
				<p class="px-3 py-3 text-sm text-brand-muted">
					{block.key === 'inputs'
						? 'Nothing read yet.'
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
