<script lang="ts">
	// The Visits tab: the portal's wide data row, one per (site, date), as a spreadsheet grid, with
	// the record of the visit the operator opens below it. The page hosts it and owns the flag dialog
	// it opens.
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { listAll } from '$api/paged';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { me } from '$auth/me.svelte';
	import { stagedVisit, stagedVisitFrom } from '$lib/stores/visit.svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { rowProvenanceLabel } from '$lib/origin';
	import { lastRunOfCalculation } from '$lib/tools/visitPrefill';
	import { deepLinkParameter } from '$lib/visits/link';
	import { pickerOptions, retiredSuffix } from '$lib/instruments/kind';
	import {
		api,
		type SiteParameter,
		type ReprocessingJob,
		type ParameterGroup,
		type Sensor,
	} from '$api/crud';
	import {
		downloadSiteVisitsCsv,
		listSiteVisits,
		stageCollectionEvents,
		saveGrabSample,
		previewEdit,
		commitEdit,
		rollbackEditSet,
		getEditSet,
		getCalculationClosure,
		listTools,
		seasonalCheck,
		getCollectionEventDetail,
		previewCollectionEvent,
		previewUnstagedVisit,
		recomputeCollectionEvent,
		runEventAudit,
		runEventRecompute,
		pollJob,
		getToolRunTrace,
		type ToolRunTrace,
		type VisitCell,
		type VisitRow,
		type VisitsResponse,
		type EventDetailResponse,
	} from '$api/service';
	import type { SampleReplicate } from '$lib/api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { appliedOffset, entryZone, zoneOptions } from '$lib/time/zones';
	import { formatDateTime } from '$lib/utils';
	import { formatMeasurement } from '$lib/format';
	import {
		cellRecord,
		findingLabel,
		firstFindingParameter,
		recordRows,
		slotTableLabel,
		statisticsParts,
		visitCellMarker,
		visitCellStatistics,
		visitCounts,
	} from '$lib/visits/cell';
	import { connectionsOf, covers, type Connections } from '$lib/visits/connections';
	import {
		asking,
		awaitedAt,
		awaitingRun,
		failed,
		previewAsks,
		previewNotice,
		previewedAt,
		settled,
		unanswered,
		type PreviewAsk,
		type Previews,
	} from '$lib/visits/preview';
	import {
		visitBadge,
		visitSourceLabel,
	} from '$lib/visits/recompute';
	import { verificationBadge, verificationNoticeFor } from '$lib/visits/verification';
	import Button from '$components/ui/Button.svelte';
	import InfoTip from '$components/ui/InfoTip.svelte';
	import TimestampInput from '$components/ui/TimestampInput.svelte';
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import { barExtent, visitsExtent, type Extent } from '$lib/sites/visitsExtent';
	import { allParameterGroups, parameterGroupMembers } from '$lib/sites/siteCatalogs';
	import Badge from '$components/ui/Badge.svelte';
	import { BADGE_BASE, BADGE_VARIANTS, type BadgeVariant } from '$components/ui/badge';
	import SheetGrid from '$components/ui/SheetGrid.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import PointInspector from '$components/provenance/PointInspector.svelte';
	import CellEquation from '$components/tools/CellEquation.svelte';
	import { inputOrigin } from '$lib/tools/equation';
	import {
		CALCULATION_FILTER,
		askedWidth,
		calculationsOf,
		columnsInGroup,
		expandable,
		parameterColumns,
		slotsOf,
		toggled,
		type GridSlot,
		type ParameterColumn,
	} from '$lib/visits/columns';
	import {
		FROZEN_COLUMNS,
		applyChanges,
		displayText,
		oncePerFrame,
		pasteOverflow,
		sheetData,
		sheetHeaders,
		sheetSlot,
		visitDates,
		type SheetTable,
	} from '$lib/visits/sheet';
	import {
		gridRows,
		keptAfterSave,
		namedInstants,
		racedRows,
		saveLabel,
		savedLine,
		spareCount,
		spareNotice,
		spareVisits,
		stagedLabel,
		staging,
		standingInstants,
		writableEdits,
	} from '$lib/visits/spareRows';
	import type { CellProperties, GridSettings, HotInstance } from 'handsontable';
	import {
		checkSatisfied,
		checkSignature,
		correctionKeys,
		editable,
		expectedReplicates,
		needsCheck,
		screenedValues,
		cleared,
		pendingCount,
		hasUnsavedEntries,
		UNSAVED_PROMPT,
		pendingWrites,
		withdrawalKeys,
		storedAt,
		typeableReplicate,
		instrumentKey,
		isSpare,
		pasteNotice,
		type Edits,
		type VisitWrite,
	} from '$lib/visits/tableEdit';
	import { cellRole, cellWritable, columnRole, editConsequence, ROLE_CLASSES } from '$lib/visits/role';
	import { cellCurves, visitCellComputedCurveMark, visitCellCurveMark } from '$lib/visits/curve';
	import { cellFinding, visitRowHeader } from '$lib/visits/rowHeader';
	import { instrumentCurves } from '$lib/visits/instrument';
	import { curveRefs } from '$lib/curveRefs.svelte';
	import { seasonalFindingLabel } from '$lib/seasonal';
	import { changedPayload, readUntilSettled, runOutputs, runReportLine } from '$lib/visits/recompute';
	import Dialog from '$components/ui/Dialog.svelte';
	import RollbackDialog from '$components/provenance/RollbackDialog.svelte';
	import { restoredLines } from '$lib/provenance/decisions';
	import { browserLocale } from '$lib/visits/number';
	import NewVisitDialog from '$components/visits/NewVisitDialog.svelte';

	interface FlagTarget {
		parameterId: string;
		parameterName: string;
		timeIso: string;
		replicates: SampleReplicate[];
		onSaved: () => void;
	}

	let {
		siteId,
		siteName,
		siteParameters,
		active,
		paramName,
		unitsForParameter,
		decimalsForParameter,
		visitPointLink,
		onFlag,
		onDataChanged,
		onUnsaved = () => {},
		sitePeriod = null,
	}: {
		siteId: string;
		siteName: string | null;
		siteParameters: SiteParameter[];
		/// Whether the tab is the one on screen: the grid loads when it is, not before.
		active: boolean;
		paramName: (paramId: string) => string;
		unitsForParameter: (paramId: string) => string | null;
		decimalsForParameter: (paramId: string) => number | null;
		visitPointLink: (eventId: string, parameterId: string) => string;
		onFlag: (target: FlagTarget) => void;
		/// A recompute wrote readings, so the page refetches what it plots.
		onDataChanged: () => void;
		/// Whether the grid holds something typed and not saved, so the page can ask before its
		/// tab is left.
		onUnsaved?: (unsaved: boolean) => void;
		/// The period the site holds data in, which the bar spans where its visits do not.
		sitePeriod?: Extent | null;
	} = $props();

	function openVisitFlag(visitId: string, replicates: SampleReplicate[]) {
		if (!visitCell || !visitDetail) return;
		const parameterId = visitCell.parameterId;
		onFlag({
			parameterId,
			parameterName: visitCell.parameterName,
			timeIso: visitDetail.collected_at,
			replicates,
			onSaved: () => void Promise.all([openVisit(visitId, true, parameterId), loadVisits()]),
		});
	}

	// --- Visits: the portal's wide data row, one per (site, date) ---
	let visits = $state.raw<VisitRow[]>([]);
	let visitColumns = $state.raw<VisitsResponse['expected_parameters']>([]);
	// The last listing drawn, as text, so a poll serving the same one leaves the grid alone.
	let heldListing: string | null = null;
	let visitsLoading = $state(false);
	let visitsLoadedKey = '';
	let expandedVisit = $state<string | null>(null);
	let visitDetail = $state<EventDetailResponse | null>(null);
	let visitDetailLoading = $state(false);
	let visitBusy = $state<string | null>(null);
	let visitCell = $state<{ parameterId: string; parameterName: string } | null>(null);

	// The selected grid position, and what a calculation connects it to at its own visit. The
	// detail carrying the consumed keys is fetched once per visit and kept: selection moves cell
	// by cell, and the grid repaints on every move.
	let selected = $state<{ visitId: string; parameterId: string; replicateIndex: number } | null>(
		null,
	);
	let connections = $state<Connections>({ reads: [], readBy: [] });
	const details = new SvelteMap<string, EventDetailResponse>();

	async function selectSlot(row: number, column: number) {
		const at = spareAt(row) ? null : sheetSlot(table, row, column);
		const next = at
			? {
					visitId: at.visit.id,
					parameterId: at.slot.parameterId,
					replicateIndex: at.slot.replicateIndex,
				}
			: null;
		if (
			next?.visitId === selected?.visitId &&
			next?.parameterId === selected?.parameterId &&
			next?.replicateIndex === selected?.replicateIndex
		) {
			return;
		}
		selected = next;
		connections = { reads: [], readBy: [] };
		requestRender();
		if (!next) return;
		const detail = details.get(next.visitId) ?? (await loadConnections(next.visitId));
		// The selection may have moved on while the detail was in flight.
		if (!detail || selected?.visitId !== next.visitId) return;
		const found = connectionsOf(detail, next.parameterId);
		if (found.reads.length === 0 && found.readBy.length === 0) return;
		connections = found;
		requestRender();
	}

	async function loadConnections(id: string): Promise<EventDetailResponse | null> {
		try {
			const detail = await getCollectionEventDetail(id);
			details.set(id, detail);
			return detail;
		} catch {
			// Without the detail nothing is highlighted, which is the honest state.
			return null;
		}
	}

	// The equation behind a computed cell, opened from its badge. A run's trace is fetched once
	// and kept, keyed by run, with the error in its place when the run cannot be replayed.
	let equationCell = $state<string | null>(null);
	const traces = new SvelteMap<string, ToolRunTrace | string>();
	async function toggleEquation(key: string, runId: string) {
		equationCell = equationCell === key ? null : key;
		if (equationCell === null || traces.has(runId)) return;
		try {
			traces.set(runId, await getToolRunTrace(runId));
		} catch (e) {
			traces.set(runId, e instanceof Error ? e.message : 'The calculation could not be replayed');
		}
	}

	// The date range filter. Unset lists every visit at the site, which is the default: a
	// station holds tens of visits, and the page devoted to them lists them all.
	let visitsStart = $state<string | null>(null);
	let visitsEnd = $state<string | null>(null);
	// The period the site holds visits in, read from the unfiltered listing the tab opens with, so
	// narrowing the filter does not shrink the bar the narrowing is done on.
	let visitsSpan = $state<Extent | null>(null);
	// A site with fewer than two visit instants, or a tab opened on a filtered range, spans the
	// period the site holds data in, so the bar is there wherever the dates are.
	const barSpan = $derived(barExtent(visitsSpan, sitePeriod));
	let sliderStart = $state(0);
	let sliderEnd = $state(0);
	// The bar and the typed dates are one filter, so each follows the other.
	$effect(() => {
		const span = barSpan;
		if (!span) return;
		sliderStart = visitsStart ? Date.parse(visitsStart) : span.min;
		sliderEnd = visitsEnd ? Date.parse(visitsEnd) : span.max;
	});
	function onVisitsRangeDragged(start: number, end: number) {
		visitsStart = new Date(start).toISOString();
		visitsEnd = new Date(end).toISOString();
	}
	let visitsDownloading = $state(false);
	// Which parameters are open to their repeats. Per table, not per row: every visit shows the
	// same columns, so a value stays under its own header.
	// The parameter groups the site's slots belong to, so the table narrows to one the way the
	// entry grid does. Loaded once with the tab, not per visit.
	let groups = $state<ParameterGroup[]>([]);
	let groupOf = $state<Record<string, string>>({});
	let groupFilter = $state('');
	// Each calculation's label by tool name, for the filter and the headers of what it writes.
	let toolLabels = $state<Record<string, string>>({});
	const toolLabel = (name: string) => toolLabels[name] ?? name;

	async function loadGroups() {
		try {
			const [groupRows, members, sensors] = await Promise.all([
				allParameterGroups(),
				parameterGroupMembers(),
				listAll(api.sensors, { sort: ['name', 'ASC'] }),
			]);
			groups = groupRows;
			groupOf = Object.fromEntries(members.map((m) => [m.parameter_id, m.group_id]));
			instruments = sensors;
		} catch {
			// These are affordances; without them the table still lists and saves.
		}
		try {
			toolLabels = Object.fromEntries((await listTools()).map((t) => [t.name, t.label]));
		} catch {
			// Without labels a calculation is named by its tool name.
		}
	}

	let expandedColumns = $state<Set<string>>(new Set());
	// Repeats the operator has asked a group for, past what the store holds. A field day that took
	// a fourth measurement needs the column before it can hold the value.
	let askedColumns = $state<Map<string, number>>(new Map());
	const allColumns = $derived(
		parameterColumns(visitColumns, visits, expandedColumns, askedColumns),
	);
	const siteCalculations = $derived(calculationsOf(allColumns));
	const groupColumns = $derived(columnsInGroup(allColumns, groupOf, groupFilter));


	// Typing into the table. One Save writes every visit it touched; the model that decides what a
	// cell is (a correction keyed on its stream, or an entry rewriting its group) is `tableEdit`.
	const locale = browserLocale();
	let edits = $state<Edits>({});
	let saving = $state(false);
	let saveRefusal = $state('');
	// One screening per visit typing a value: the server holds each save to exactly the values its
	// own check covered, and a visit's check re-arms when that visit's entries or corrections move.
	let checks = $state<Record<string, { id: string; signature: string }>>({});
	let checking = $state(false);
	let seasonalFindings = $state<{ parameterId: string; text: string }[]>([]);
	let confirmOpen = $state(false);
	let consequence = $state<string | null>(null);
	/** What the calculations behind the save moved, read from the values on each side of it. */
	let runReport = $state<string | null>(null);
	// What measured each group, declared per (visit, parameter) and stored on every value that
	// group enters. Nothing declares one for a correction: that value already names what made it.
	let declaredInstruments = $state<Record<string, string>>({});
	let instruments = $state<Sensor[]>([]);
	// A declared instrument says how many curves it carries, so a declaration of one with none is
	// visible where it is made.
	$effect(() => {
		curveRefs.ensureCurveCounts(Object.values(declaredInstruments));
	});

	// The spare area under the last listed visit: a date typed or pasted there stages a visit at
	// that instant, and the values beside it are that visit's entries, saved by the same one Save.
	let spareDates = $state<Record<string, string>>({});
	let askedSpares = $state(1);
	// Instants this site holds a visit at that the listing does not show: the grid is filtered and
	// paged, so a date typed here is looked up against the store rather than against the rows on
	// screen (Q225).
	let standingElsewhere = $state<string[]>([]);
	// The zone a date with no offset of its own is read in, so a field day recorded elsewhere is
	// pasted as it was written. Until somebody picks one it is the zone the Date column prints.
	let pickedZone = $state<string | null>(null);
	const zones = zoneOptions();
	const readZone = $derived(entryZone(pickedZone, timezoneStore.zone));
	const readOffset = $derived(appliedOffset(readZone).label);
	const spareRowCount = $derived(spareCount(spareDates, edits, askedSpares));
	const spares = $derived(
		spareVisits(spareDates, spareRowCount, standingInstants(visits, standingElsewhere), readZone),
	);
	const newVisits = $derived(staging(spares));
	const spareRefusal = $derived(spareNotice(spares, edits));

	// Every instant a date cell has named so far, so one lookup per new date covers every row.
	const askedInstants = new Set<string>();

	/**
	 * Which of the dates typed into the spare area this site already holds a visit at. One list
	 * call per new date, filtered to the instants themselves, so a visit off the listed page still
	 * refuses the row.
	 */
	async function lookUpStanding(instants: string[]) {
		const wanted = instants.filter((at) => !askedInstants.has(at));
		if (wanted.length === 0) return;
		for (const at of wanted) askedInstants.add(at);
		try {
			const page = await api.collectionEvents.list({
				filter: { site_id: siteId, collected_at: wanted },
				perPage: wanted.length,
			});
			const found = page.data.map((e) => e.collected_at);
			if (found.length > 0) standingElsewhere = [...standingElsewhere, ...found];
		} catch {
			// The refusal the listing already knows still stands; the save's own stage is the backstop.
			for (const at of wanted) askedInstants.delete(at);
		}
	}

	$effect(() => {
		const wanted = namedInstants(spareDates, spareRowCount, readZone);
		untrack(() => void lookUpStanding(wanted));
	});
	// A visit down, a (parameter, replicate) slot across, after the frozen date, source and fill.
	const slots = $derived(slotsOf(groupColumns));
	const table = $derived<SheetTable>({
		rows: gridRows(visits, spares),
		stored: visits.length,
		slots,
	});
	// Each visit's date as its cells name it, formatted once per row and again when the zone changes.
	const dates = $derived(visitDates(table.rows, formatDateTime));
	// What a Save writes: a refused spare row's cells stay on screen and are written by nothing.
	const written = $derived(writableEdits(edits, spares));
	const writes = $derived(pendingWrites(table.rows, written, locale, declaredInstruments));
	/** What a paste left behind, held on screen until the next one rather than passed as a toast. */
	let pasteRefusal = $state<string | null>(null);
	// What the calculations would say about each visit typed into, asked as the typing settles.
	let previews = $state<Previews>({});
	// What the previews said at the last Save, shown until the run it queued lands.
	let awaiting = $state<Previews>({});
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	/** How long the typing must settle before the calculations are asked. */
	const PREVIEW_DELAY_MS = 350;

	// --- The grid ---
	// Handsontable owns selection, the keyboard, the clipboard, the fill handle and undo. Every
	// change it makes is recorded in `edits`, which is what Check and Save read.
	let hot: HotInstance | null = null;
	// Every redraw asked for inside one frame is drawn once.
	const requestRender = oncePerFrame(() => hot?.render());
	let canUndo = $state(false);
	// Bumped where the typed cells are cleared, so the grid reloads what the store holds.
	let dataVersion = $state(0);
	let pasteUnreadable = 0;
	let pasteOverflowCount = 0;

	function writableSlot(visit: VisitRow, slot: GridSlot): boolean {
		return (
			editable(slot.column) &&
			slotWritable(visit, slot.parameterId, slot.replicateIndex).writable
		);
	}

	// The typed cells are read once per load: a keystroke changes the grid itself, not its data.
	// The spare area grows the same way, by the grid's own trailing row, and is pushed back here
	// only when a paste, a discard or a save has settled what it holds.
	const gridData = $derived.by(() => {
		void dataVersion;
		void askedSpares;
		void visits;
		void slots;
		void me.level;
		void timezoneStore.zone;
		return untrack(() =>
			sheetData(table, edits, spareDates, locale, timezoneStore.zone, writableSlot),
		);
	});

	type SheetSettings = Omit<GridSettings, 'data' | 'licenseKey' | 'themeName'>;

	const gridSettings = $derived.by((): SheetSettings => {
		void me.level;
		void visits;
		return {
			nestedHeaders: sheetHeaders(groupColumns, timezoneStore.zone),
			rowHeaders: true,
			wordWrap: false,
			fixedColumnsStart: FROZEN_COLUMNS,
			colWidths: (index: number) => (index === 0 ? 180 : 100),
			width: '100%',
			height: 'auto',
			manualColumnResize: true,
			fillHandle: { direction: 'vertical', autoInsertRow: false },
			// A pasted block runs into the spare area, which grows to take it.
			minSpareRows: 1,
			allowInsertRow: true,
			allowInsertColumn: false,
			allowRemoveRow: false,
			allowRemoveColumn: false,
			undo: true,
			outsideClickDeselects: false,
			contextMenu: [
				'copy',
				'undo',
				'redo',
				'---------',
				{
					key: 'open_record',
					name: 'Open record',
					callback: (_key: string, selection: { start: { row: number; col: number } }[]) => {
						const start = selection[0]?.start;
						if (start) void openRecordAt(start.row, start.col);
					},
				},
			],
			cells: cellMeta,
			afterGetRowHeader: renderRowHeader,
		} as SheetSettings;
	});

	/** Whether the row at a grid position is a spare one, which has no record to open. */
	function spareAt(row: number): boolean {
		const at = table.rows[row];
		return at !== undefined && isSpare(at.id);
	}

	/** Whether the spare row at a grid position stages nothing, which its whole row says. */
	function refusedAt(row: number): boolean {
		const at = table.rows[row];
		return at !== undefined && spares.some((s) => s.id === at.id && s.problem !== null);
	}

	function cellMeta(row: number, column: number) {
		// A listed visit's date is read-only: its instant is what its readings are keyed on. A spare
		// row's is where the new visit is named.
		if (column < FROZEN_COLUMNS) {
			return { readOnly: !(spareAt(row) && me.can('enterFieldData')), renderer: renderFrozen };
		}
		const at = sheetSlot(table, row, column);
		return { readOnly: !at || !writableSlot(at.visit, at.slot), renderer: renderValue };
	}

	const CELL_CLASSES = [
		'sheet-refused',
		'htDimmed',
		'htRight',
		'htNumeric',
		'sheet-struck',
		'sheet-warning',
		'sheet-finding',
		'sheet-edited',
		'sheet-open-row',
		'sheet-reads',
		'sheet-read-by',
		...ROLE_CLASSES,
	];

	/** A cell element is reused across positions, so each render starts from nothing. */
	function resetCell(td: HTMLTableCellElement, row: number) {
		td.classList.remove(...CELL_CLASSES);
		td.replaceChildren();
		td.removeAttribute('title');
		td.removeAttribute('aria-label');
		if (table.rows[row] && table.rows[row].id === expandedVisit) td.classList.add('sheet-open-row');
	}

	function chip(label: string, variant: BadgeVariant, title: string): HTMLSpanElement {
		const span = document.createElement('span');
		span.className = `ml-1 ${BADGE_BASE} ${BADGE_VARIANTS[variant]}`;
		span.textContent = label;
		span.title = title;
		return span;
	}

	/**
	 * The selected cell's corner control, which opens the record of that one recording. Alt+Enter
	 * does the same from the keyboard, including on a cell open to typing, where Enter edits.
	 */
	function recordingControl(visitId: string, parameterId: string, name: string): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		// The glyph is drawn by CSS: a text node here would join the cell's text, which is what
		// the sheet copies and round-trips through the grid.
		button.className = 'sheet-corner';
		button.setAttribute('aria-label', `Open the record of ${name} at this visit`);
		button.title = `Open the record of ${name} at this visit (Alt+Enter)`;
		button.addEventListener('mousedown', (e) => e.stopPropagation());
		button.addEventListener('click', (e) => {
			e.stopPropagation();
			void openVisitCell(visitId, parameterId);
		});
		return button;
	}

	function mark(text: string, className: string): HTMLSpanElement {
		const span = document.createElement('span');
		span.className = className;
		span.textContent = text;
		return span;
	}

	function renderFrozen(_hot: unknown, td: HTMLTableCellElement, row: number) {
		resetCell(td, row);
		const visit = table.rows[row];
		if (!visit) return td;
		if (isSpare(visit.id)) return renderSpare(td, visit.id);
		td.classList.add('htDimmed');
		const open = expandedVisit === visit.id;
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'sheet-link';
		button.setAttribute('aria-expanded', String(open));
		button.title = open ? 'Collapse this visit' : 'Expand this visit';
		button.textContent = gridData[row]?.[0] ?? '';
		// The press must not reach the grid: a selection change re-renders this cell between
		// mousedown and mouseup, and a button replaced mid-press is sent no click at all.
		button.addEventListener('mousedown', (e) => e.stopPropagation());
		button.addEventListener('click', () => void openVisit(visit.id));
		td.append(button);
		return td;
	}

	/**
	 * A row of the spare area: the date as typed, said to be opening a visit rather than editing
	 * one, and named where it opens none.
	 */
	function renderSpare(td: HTMLTableCellElement, id: string) {
		const spare = spares.find((s) => s.id === id);
		if (!spare) return td;
		td.append(spare.typed);
		if (spare.problem) {
			td.classList.add('sheet-refused');
			td.append(chip(spare.problem, 'alarm', spare.problem));
		} else if (spare.collectedAt) {
			td.append(
				chip(
					stagedLabel(spare.collectedAt),
					'accent',
					'The visit this row will open when what you typed is saved',
				),
			);
		} else {
			td.title = 'Type or paste a date here to open a new visit at this site';
		}
		return td;
	}

	function renderValue(
		_hot: unknown,
		td: HTMLTableCellElement,
		row: number,
		column: number,
		_prop: unknown,
		_value: unknown,
		cellProperties: CellProperties,
	) {
		resetCell(td, row);
		const at = sheetSlot(table, row, column);
		if (!at) return td;
		const { visit, slot, cell, replicate } = at;
		const open = slot.column.expanded;
		const writable = !cellProperties.readOnly;
		const spareDate = isSpare(visit.id) ? (spareDates[visit.id]?.trim() ?? '') : null;
		const when = spareDate === null ? (dates[visit.id] ?? formatDateTime(visit.collected_at)) : spareDate;
		td.classList.add('htRight', 'htNumeric');
		if (!writable) td.classList.add('htDimmed');
		// What the column is to the calculations, on every cell of it, so a value says what it
		// feeds while it is typed. The selection below narrows this to the stored connections.
		const role = columnRole(slot.column);
		if (role.className) td.classList.add(...role.className.split(' '));
		if (role.title) td.title = role.title;
		if (refusedAt(row)) td.classList.add('sheet-refused');
		// A spare row naming no date yet is placed rather than dated: there is no instant to say.
		const repeat = open ? ` repeat ${slot.replicateIndex + 1}` : '';
		td.setAttribute(
			'aria-label',
			when === ''
				? `${slot.column.code}${repeat} on the new row`
				: `${slot.column.code}${repeat} at ${when}`,
		);
		if (visit.id === selected?.visitId) {
			const own =
				slot.parameterId === selected.parameterId &&
				(!open || slot.replicateIndex === selected.replicateIndex);
			if (own) td.append(recordingControl(visit.id, slot.parameterId, slot.column.name));
			else if (covers(connections.reads, slot.parameterId, slot.replicateIndex, open)) {
				td.classList.add('sheet-reads');
			} else if (covers(connections.readBy, slot.parameterId, slot.replicateIndex, open)) {
				td.classList.add('sheet-read-by');
			}
		}
		const typed = at.key in edits;
		if (typed) td.classList.add('sheet-edited');
		// A column a calculation writes shows what the typed values would make it, until Save
		// writes it. A stored number is not left standing as though it were that answer: while the
		// preview is in flight or has failed the cell says so.
		const preview = previews[visit.id];
		if (preview && slot.column.writtenBy) {
			const shown = previewedAt(preview, slot);
			if (shown !== undefined) {
				td.classList.add('sheet-preview');
				td.title = `${slot.column.writtenBy} gives this from the values you have typed. It is not saved yet; Save writes it.`;
				if (shown === null) {
					td.append(mark('clears', 'sheet-mark'));
					return td;
				}
				td.append(document.createTextNode(formatMeasurement(shown, slot.column.decimals)));
				return td;
			}
			if (preview.state === 'pending') {
				td.classList.add('sheet-preview-pending');
				td.title = `Working out what ${slot.column.writtenBy} gives from the values you have typed`;
			} else if (preview.state === 'error') {
				td.classList.add('sheet-preview-pending');
				td.title = `What ${slot.column.writtenBy} would give could not be worked out: ${preview.message ?? 'the preview did not run'}. The value shown is the one stored.`;
			}
		} else if (slot.column.writtenBy) {
			const awaited = previewedAt(awaitedAt(awaiting, visit), slot);
			if (awaited !== undefined) {
				td.classList.add('sheet-preview-pending');
				td.title = `${slot.column.writtenBy} is running on the saved values. This is what it gave before Save; the stored value replaces it once the run lands.`;
				td.append(awaited === null ? mark('clears', 'sheet-mark') : document.createTextNode(formatMeasurement(awaited, slot.column.decimals)));
				return td;
			}
		}
		const state = open ? replicate : cell;
		if (state?.withdrawn) td.classList.add('sheet-struck');
		if (state?.flagged || (open && replicate?.unverified)) td.classList.add('sheet-warning');
		const finding = open ? null : cellFinding(cell);
		if (finding) td.classList.add(finding.className);
		if (writable || typed) {
			td.append(displayText(at, edits, writable));
			if (!open && !typed) markCurve(td, cell);
			if (finding) td.title = [td.title, finding.title].filter(Boolean).join('\n');
			return td;
		}
		if (open) {
			td.append(displayText(at, edits, writable));
			if (replicate) {
				td.title = [
					`Repeat ${replicate.replicate_index + 1} of ${slot.column.name} at this visit`,
					slotWritable(visit, slot.parameterId, slot.replicateIndex).reason,
				]
					.filter(Boolean)
					.join('\n');
			}
			return td;
		}
		if (!cell) return td;
		if (cell.finding === 'missing_output' && cell.value == null) {
			td.append(chip('missing', 'warning', 'A calculation was expected to write this value and did not'));
		} else if (cell.value != null) {
			td.append(displayText(at, edits, writable));
			if ((cell.n ?? 0) > 1) td.append(mark(`n${cell.n}`, 'sheet-mark'));
			const marker = visitCellMarker(cell);
			if (marker) {
				const flag = mark(marker.text, 'sheet-mark sheet-warning');
				flag.title = marker.title;
				td.append(flag);
			}
		}
		td.title = [
			finding?.title,
			visitCellStatistics(cell, slot.column.decimals, slot.column.units),
			`Open the record of ${slot.column.name} at this visit`,
		]
			.filter(Boolean)
			.join('\n');
		markCurve(td, cell);
		return td;
	}

	/**
	 * The curve a stored value was corrected through, and the one its calculation computed it
	 * through, each as a mark and a line of the cell's title.
	 */
	function markCurve(td: HTMLTableCellElement, cell: VisitCell | null | undefined) {
		if (!cell || cell.value == null) return;
		for (const curve of [visitCellCurveMark(cell), visitCellComputedCurveMark(cell)]) {
			if (!curve) continue;
			const marked = mark(curve.text, 'sheet-mark');
			marked.title = curve.title;
			td.append(marked);
			td.title = [td.title, curve.title].filter(Boolean).join('\n');
		}
	}

	const ROW_HEADER_CLASSES = ['sheet-finding', 'sheet-struck', 'sheet-pending'];

	/** A row's index, toned by its findings and its field day's verification. */
	function renderRowHeader(row: number, th: HTMLTableCellElement) {
		th.classList.remove(...ROW_HEADER_CLASSES);
		th.removeAttribute('title');
		const visit = table.rows[row];
		if (!visit || isSpare(visit.id)) return;
		const header = visitRowHeader(visit);
		if (header.classNames.length) th.classList.add(...header.classNames);
		if (header.title) th.title = header.title;
	}

	/** The group header's own controls: open to the repeats, and one repeat fewer or more. */
	function renderGroupHeader(column: number, th: HTMLTableCellElement, level: number) {
		if (level !== 0 || column < FROZEN_COLUMNS) return;
		const col = groupStartingAt(column);
		const label = th.querySelector('.colHeader');
		if (!col || !label) return;
		label.replaceChildren();
		th.title = col.name;
		const button = (text: string, aria: string, title: string, onclick: () => void) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'sheet-header-button';
			b.textContent = text;
			b.setAttribute('aria-label', aria);
			b.title = title;
			b.addEventListener('mousedown', (e) => e.stopPropagation());
			b.addEventListener('click', (e) => {
				e.stopPropagation();
				onclick();
			});
			return b;
		};
		if (expandable(visits, col.parameterId)) {
			const toggle = button(
				`${col.code}${col.expanded ? ' −' : ' +'}`,
				col.code,
				col.expanded ? `Fold ${col.code} back to its served value` : `Open ${col.code} to its repeats`,
				() => (expandedColumns = toggled(expandedColumns, col.parameterId)),
			);
			toggle.className = 'sheet-link';
			toggle.setAttribute('aria-expanded', String(col.expanded));
			label.append(toggle);
		} else {
			label.append(col.code);
		}
		if (col.units) label.append(mark(` (${col.units})`, 'sheet-mark'));
		if (col.writtenBy) {
			const calculated = mark(` = ${toolLabel(col.writtenBy)}`, 'sheet-mark');
			th.title = `${col.name}, calculated by ${toolLabel(col.writtenBy)}`;
			calculated.title = th.title;
			label.append(calculated);
		}
		if (col.expanded && me.can('enterFieldData')) {
			label.append(
				button(
					'−',
					`One repeat fewer for ${col.code}`,
					'One repeat fewer. A repeat the store holds is not dropped here: that is a withdrawal.',
					() => (askedColumns = askedWidth(askedColumns, visits, col.parameterId, col.width - 1)),
				),
				button('+', `One repeat more for ${col.code}`, 'One repeat more', () =>
					(askedColumns = askedWidth(askedColumns, visits, col.parameterId, col.width + 1)),
				),
			);
		}
	}

	function groupStartingAt(column: number): ParameterColumn | null {
		let offset = FROZEN_COLUMNS;
		for (const col of groupColumns) {
			if (offset === column) return col;
			offset += col.width;
		}
		return null;
	}

	function gridReady(instance: HotInstance) {
		hot = instance;
		const undoRedo = instance.getPlugin('undoRedo');
		instance.addHook('beforeChange', (changes, source) => {
			const applied = applyChanges(
				table,
				edits,
				spareDates,
				changes.map((c) => ({
					row: c?.[0] ?? -1,
					column: Number(c?.[1]),
					raw: c?.[3] == null ? '' : String(c[3]),
				})),
				locale,
				source === 'CopyPaste.paste' || source === 'Autofill.fill',
			);
			for (const index of applied.refused) changes[index] = null;
			edits = applied.edits;
			spareDates = applied.dates;
			if (source === 'CopyPaste.paste') pasteUnreadable = applied.unreadable;
			else pasteRefusal = pasteNotice({ edits, unreadable: applied.unreadable, overflow: 0 });
		});
		instance.addHook('afterChange', () => (canUndo = undoRedo.isUndoAvailable()));
		instance.addHook('afterLoadData', () => (canUndo = false));
		// A block running past the last row grows the spare area onto it first, because the paste
		// fills the rows the table has and drops the rest.
		instance.addHook('beforePaste', (data, coords) => {
			pasteUnreadable = 0;
			const range = coords[0];
			if (!range) {
				pasteOverflowCount = 0;
				return;
			}
			const short = range.startRow + data.length - table.rows.length;
			if (short > 0) {
				askedSpares = spares.length + short;
				instance.loadData(gridData);
			}
			pasteOverflowCount = pasteOverflow(
				data.map((line) => line.map((v) => (v == null ? '' : String(v)))),
				range.startCol,
				instance.countCols(),
			);
		});
		// The block the paste recorded is the table's row count now, so the grid reloads onto it.
		instance.addHook('afterPaste', () => {
			pasteRefusal = pasteNotice({ edits, unreadable: pasteUnreadable, overflow: pasteOverflowCount });
			dataVersion += 1;
		});
		instance.addHook('afterGetColHeader', renderGroupHeader);
		// The index of a row with findings opens the visit on the first of them, so one standing in
		// a group off screen is still reached from its row.
		instance.addHook('afterOnCellMouseDown', (_event: MouseEvent, coords: { row: number; col: number }) => {
			if (coords.col !== -1 || coords.row < 0) return;
			const visit = table.rows[coords.row];
			if (!visit || isSpare(visit.id) || !visitRowHeader(visit).opensFindings) return;
			const onFinding = firstFindingParameter(visit.cells);
			if (onFinding) void openVisitCell(visit.id, onFinding);
			else void openVisit(visit.id, true);
		});
		instance.addHook('afterSelection', (row: number, column: number) => {
			void selectSlot(row, column);
		});
		// Enter on a value nobody may type opens its record, as a double-click does. Alt+Enter
		// does it from any cell, so a slot open to typing is reachable by keyboard too.
		instance.addHook('beforeKeyDown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' || event.shiftKey) return;
			const { row, col } = instance.getSelectedRangeLast()?.highlight ?? {};
			if (row == null || col == null || row < 0 || col < 0) return;
			if (!event.altKey && !instance.getCellMeta(row, col).readOnly) return;
			event.stopImmediatePropagation();
			void openRecordAt(row, col);
		});
		instance.rootElement.addEventListener('dblclick', (event) => {
			const td = (event.target as HTMLElement).closest('td');
			if (!td) return;
			const { row, col } = instance.getCoords(td) ?? {};
			if (row == null || col == null || row < 0 || col <= 0) return;
			if (!instance.getCellMeta(row, col).readOnly) return;
			void openRecordAt(row, col);
		});
	}

	function undoEdit() {
		hot?.getPlugin('undoRedo').undo();
	}

	function discardEdits() {
		edits = {};
		spareDates = {};
		askedSpares = 1;
		checks = {};
		seasonalFindings = [];
		pasteRefusal = null;
		previews = {};
		dataVersion += 1;
	}

	// The calculations run on what is typed, not on what is stored, and store nothing (Q212). The
	// ask is made once the typing settles; an answer about a grid the operator has already typed
	// past is dropped rather than drawn.
	$effect(() => {
		const asks = previewAsks(table.rows, edits, locale);
		untrack(() => schedulePreviews(asks));
	});

	function schedulePreviews(asks: PreviewAsk[]) {
		if (previewTimer) clearTimeout(previewTimer);
		const sending = unanswered(previews, asks);
		const next = asking(previews, asks);
		if (next !== previews) {
			previews = next;
			requestRender();
		}
		if (sending.length === 0) return;
		previewTimer = setTimeout(() => void runPreviews(sending), PREVIEW_DELAY_MS);
	}

	async function runPreviews(asks: PreviewAsk[]) {
		for (const ask of asks) {
			try {
				const preview = ask.at
					? await previewUnstagedVisit(siteId, ask.at, ask.cells)
					: await previewCollectionEvent(ask.eventId, ask.cells);
				previews = settled(previews, ask, preview);
			} catch (e) {
				previews = failed(previews, ask, e instanceof Error ? e.message : String(e));
			}
		}
		requestRender();
	}

	const previewLine = $derived(previewNotice(previews));

	// The open visit's row is marked and a spare row names the instant its date resolved to, so
	// both the open record and the entry zone redraw the rows the grid has already drawn.
	$effect(() => {
		void expandedVisit;
		void readZone;
		untrack(() => requestRender());
	});

	const screened = $derived(checkSatisfied(writes, checks));
	const typing = $derived(writes.some(needsCheck));
	const moved = $derived(pendingCount(written, locale));
	const unsaved = $derived(hasUnsavedEntries(edits, spareDates));
	$effect(() => onUnsaved(unsaved));

	beforeNavigate((navigation) => {
		if (unsaved && navigation.type !== 'leave' && !confirm(UNSAVED_PROMPT)) navigation.cancel();
	});

	function warnBeforeUnload(event: BeforeUnloadEvent) {
		if (unsaved) event.preventDefault();
	}
	// Every cleared cell withdraws a stored replicate, by its own edit or by the replace of its group.
	const withdrawn = $derived(Object.values(written).filter(cleared).length);

	/**
	 * Whether this account may type over what the store holds at this slot (Q21), and whether what
	 * it holds is a measurement the table can take back.
	 */
	function slotWritable(visit: VisitRow, parameterId: string, replicateIndex: number) {
		const stored = storedAt(visit, parameterId, replicateIndex);
		const role = cellWritable(me.level, stored?.value ?? null);
		return role.writable ? typeableReplicate(stored) : role;
	}

	// The site history each visit's entered and corrected values are screened against, one call
	// per visit typing a value.
	async function screen(write: VisitWrite) {
		const response = await seasonalCheck({
			site_id: siteId,
			time: write.collectedAt,
			values: screenedValues(write),
		});
		checks = {
			...checks,
			[write.eventId]: { id: response.check_id, signature: checkSignature(write) },
		};
		return response;
	}

	/** The check a visit's save names: the current one, or a fresh one where its values moved. */
	async function checkFor(write: VisitWrite): Promise<string> {
		const current = checks[write.eventId];
		if (current?.signature === checkSignature(write)) return current.id;
		return (await screen(write)).check_id;
	}

	async function runChecks() {
		checking = true;
		seasonalFindings = [];
		try {
			const found: { parameterId: string; text: string }[] = [];
			for (const write of writes) {
				if (!needsCheck(write)) continue;
				const response = await screen(write);
				for (const finding of response.findings) {
					found.push({
						parameterId: finding.parameter_id,
						text: seasonalFindingLabel(finding, paramName(finding.parameter_id)),
					});
				}
			}
			seasonalFindings = uniqueFindings(found);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The check did not run');
		} finally {
			checking = false;
		}
	}

	/**
	 * One line per finding, however many visits raised it. The screening reports per visit and
	 * says nothing about which, so the same sentence repeated is noise rather than a second
	 * finding.
	 */
	function uniqueFindings(found: { parameterId: string; text: string }[]) {
		const seen = new Set<string>();
		return found.filter((f) => {
			const key = `${f.parameterId}|${f.text}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	/** Every parameter the save touches, which is what a closure is keyed on. */
	function touchedParameters(): string[] {
		return [
			...new Set(
				writes.flatMap((w) => [
					...w.corrections.map((c) => c.parameterId),
					...w.entries.map((e) => e.parameterId),
				]),
			),
		];
	}

	/** What the parameters being written feed, so the save can report what it moved afterwards. */
	async function calculationsBehind() {
		const parameters = touchedParameters();
		if (parameters.length === 0) return [];
		try {
			const closure = await getCalculationClosure({ parameter_ids: parameters.join(',') });
			return closure.calculations;
		} catch {
			return [];
		}
	}

	/** What each parameter served before the save, by code, to compare against afterwards. */
	function servedNow(): Record<string, number | null> {
		return Object.fromEntries(
			visitColumns.map((col) => [
				col.code,
				visits.flatMap((v) => v.cells).find((c) => c.parameter_id === col.parameter_id)?.value ??
					null,
			]),
		);
	}

	const CORRECTION = { kind: 'value_correction' as const, reason: 'corrected in the visits table' };
	const WITHDRAWAL = { kind: 'withdraw' as const, reason: 'cleared in the visits table' };

	// What a save would recompute, read from a preview of its corrections and withdrawals rather
	// than guessed.
	async function askToSave() {
		consequence = null;
		runReport = null;
		const previews = [];
		const corrected = correctionKeys(writes);
		const retracted = withdrawalKeys(writes);
		if (corrected.length > 0) previews.push(previewEdit({ keys: corrected }, CORRECTION));
		if (retracted.length > 0) previews.push(previewEdit({ keys: retracted }, WITHDRAWAL));
		if (previews.length > 0) {
			try {
				const calculations = (await Promise.all(previews)).flatMap((p) => p.calculations);
				const once = new Map(calculations.map((c) => [c.tool, c]));
				consequence = editConsequence([...once.values()], servedByCode);
			} catch {
				// The preview is the explanation, not the write; a save may still go ahead.
			}
		}
		confirmOpen = true;
	}

	/** What each parameter serves today, so a consequence can name what will move. */
	const servedByCode = $derived(
		Object.fromEntries(
			visitColumns.map((col) => [
				col.code,
				visits.flatMap((v) => v.cells).find((c) => c.parameter_id === col.parameter_id)?.value ??
					null,
			]),
		),
	);

	async function saveTable() {
		saving = true;
		saveRefusal = '';
		// What the save feeds and what those outputs serve now, so the report reads the difference
		// rather than the job.
		const expected = await calculationsBehind();
		const before = servedNow();
		try {
			// A row the stage found already standing is not written into: the lookup and the Save
			// are not one transaction, and its values belong on that visit's own row.
			const raced = await stageNewVisits();
			const recorded: SavedVisit[] = [];
			for (const write of writes) {
				if (raced.has(write.eventId)) continue;
				const saved: SavedVisit = {
					eventId: write.eventId,
					collectedAt: write.collectedAt,
					setIds: [],
					entered: write.entries.length > 0,
				};
				recorded.push(saved);
				if (write.withdrawals.length > 0) {
					const selection = { keys: withdrawalKeys([write]) };
					const preview = await previewEdit(selection, WITHDRAWAL);
					saved.setIds.push((await commitEdit(selection, WITHDRAWAL, preview.preview_id)).set_id);
				}
				if (write.corrections.length > 0) {
					const selection = { keys: correctionKeys([write]) };
					const decision = { ...CORRECTION, check_id: await checkFor(write) };
					const preview = await previewEdit(selection, decision);
					saved.setIds.push((await commitEdit(selection, decision, preview.preview_id)).set_id);
				}
				if (write.entries.length > 0) {
					const visit = table.rows.find((v) => v.id === write.eventId)!;
					const entered = await saveGrabSample({
						site_id: siteId,
						mode: 'replace',
						readings: write.entries.map((e) => ({
							parameter_id: e.parameterId,
							value: e.value,
							time: write.collectedAt,
							replicate_index: e.replicateIndex,
							...(e.sensorId ? { sensor_id: e.sensorId } : {}),
						})),
						expected_replicates: expectedReplicates(visit, write.entries),
						check_id: await checkFor(write),
					});
					if (entered.edit_set_id) saved.setIds.push(entered.edit_set_id);
				}
			}
			lastSave = recorded.filter((v) => v.setIds.length > 0);
			const kept = keptAfterSave(edits, spareDates, raced);
			toastStore.success(savedLine(moved, newVisits.length - raced.size));
			edits = kept.edits;
			spareDates = kept.dates;
			askedSpares = 1;
			dataVersion += 1;
			checks = {};
			seasonalFindings = [];
			awaiting = awaitingRun(previews, table.rows);
			previews = {};
			confirmOpen = false;
		} catch (e) {
			saveRefusal = e instanceof Error ? e.message : String(e);
			return;
		} finally {
			saving = false;
		}
		const settled = await readUntilSettled(async () => (await loadVisits()) ?? visits);
		if (settled) {
			awaiting = {};
			requestRender();
		}
		runReport = settled
			? runReportLine(runOutputs(expected, before, servedNow(), findingByCode()))
			: 'The calculations are still running: reload the visits to see their outputs.';
		onDataChanged();
	}

	// What the last Save changed in place, one recovery per visit: its corrections, withdrawals and
	// entries each recorded an edit set, and rolling the visit's save back inverts them. A replicate
	// an entry added where none was stored is not in a set, so the recovery names it.
	interface SavedVisit {
		eventId: string;
		collectedAt: string;
		setIds: string[];
		entered: boolean;
	}
	let lastSave = $state<SavedVisit[]>([]);
	let saveRecovery = $state<{ visit: SavedVisit; lines: string[]; loading: boolean; error: string } | null>(null);
	let saveRecoveryOpen = $state(false);
	let rollingBackSave = $state(false);

	async function askToRollBackSave(visit: SavedVisit) {
		saveRecovery = { visit, lines: [], loading: true, error: '' };
		saveRecoveryOpen = true;
		try {
			const sets = await Promise.all(visit.setIds.map((id) => getEditSet(id)));
			const lines = sets.flatMap((set) => restoredLines(set.members));
			if (saveRecovery?.visit.eventId === visit.eventId) saveRecovery = { ...saveRecovery, lines, loading: false };
		} catch (e) {
			if (saveRecovery?.visit.eventId === visit.eventId)
				saveRecovery = { ...saveRecovery, loading: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	async function rollBackSave() {
		if (!saveRecovery) return;
		const { visit } = saveRecovery;
		rollingBackSave = true;
		try {
			let restored = 0;
			for (const id of visit.setIds) {
				const set = await getEditSet(id);
				if (set.rolled_back_at) continue;
				restored += (await rollbackEditSet(id)).rolled_back;
			}
			toastStore.success(`${restored} value${restored === 1 ? '' : 's'} put back at ${formatDateTime(visit.collectedAt)}`);
			lastSave = lastSave.filter((v) => v.eventId !== visit.eventId);
			saveRecoveryOpen = false;
			dataVersion += 1;
			await loadVisits();
			onDataChanged();
		} catch (e) {
			saveRecovery = { ...saveRecovery, error: e instanceof Error ? e.message : String(e) };
		} finally {
			rollingBackSave = false;
		}
	}

	/**
	 * The visits the spare rows open, staged before their values are written so each one is a
	 * field day somebody opened, stamped with the stager's own level (Q177), rather than a visit
	 * a reading brought into being behind them.
	 *
	 * Staging is find-or-create, so a reply saying the visit already stood is the collision the
	 * lookup missed. Those rows are named back to the caller, which writes nothing into them.
	 */
	async function stageNewVisits(): Promise<Set<string>> {
		if (newVisits.length === 0) return new Set();
		const staged = await stageCollectionEvents({
			visits: newVisits.map((v) => ({ site_id: siteId, collected_at: v.collectedAt })),
		});
		const raced = racedRows(spares, staged);
		if (raced.size > 0) {
			standingElsewhere = [
				...standingElsewhere,
				...staged.filter((e) => !e.created).map((e) => e.collected_at),
			];
		}
		return raced;
	}

	/** The finding standing on each parameter now, so an output that did not move says why. */
	function findingByCode(): Record<string, string | undefined> {
		return Object.fromEntries(
			visitColumns.map((col) => [
				col.code,
				visits.flatMap((v) => v.cells).find((c) => c.parameter_id === col.parameter_id)?.finding,
			]),
		);
	}
	let newVisitOpen = $state(false);

	function visitsRange(): { start?: string; end?: string } {
		return {
			...(visitsStart ? { start: visitsStart } : {}),
			...(visitsEnd ? { end: visitsEnd } : {}),
		};
	}

	async function loadVisits() {
		visitsLoading = true;
		try {
			const r = await listSiteVisits(siteId, visitsRange());
			const changed = changedPayload(heldListing, r);
			if (changed === null) return r.visits;
			heldListing = changed;
			visits = r.visits;
			if (!visitsStart && !visitsEnd) visitsSpan = visitsExtent(r.visits);
			visitColumns = r.expected_parameters;
			return r.visits;
		} catch (e) {
			toastStore.error(e instanceof Error ? `Failed to load visits: ${e.message}` : 'Failed to load visits');
		} finally {
			visitsLoading = false;
		}
	}

	// Withdrawing a visit: a reversible stamp over every reading it holds, previewed first so the
	// confirmation names what it moves and what recomputes behind it.
	let withdrawOpen = $state(false);
	let withdrawing = $state(false);
	let withdrawPreviewId = $state('');
	let withdrawRows = $state(0);
	let withdrawVisitId = $state('');
	let withdrawnSetId = $state('');
	let withdrawnVisitId = $state('');
	let withdrawConsequence = $state<string | null>(null);

	async function askToWithdraw(id: string) {
		withdrawConsequence = null;
		try {
			const decision = { kind: 'withdraw' as const, reason: 'visit withdrawn' };
			const preview = await previewEdit({ collection_event_id: id }, decision);
			withdrawPreviewId = preview.preview_id;
			withdrawRows = preview.rows.length;
			withdrawVisitId = id;
			withdrawConsequence = editConsequence(preview.calculations, servedByCode);
			withdrawOpen = true;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The withdrawal could not be previewed');
		}
	}

	async function withdrawVisit() {
		withdrawing = true;
		try {
			const committed = await commitEdit(
				{ collection_event_id: withdrawVisitId },
				{ kind: 'withdraw', reason: 'visit withdrawn' },
				withdrawPreviewId,
			);
			withdrawnSetId = committed.set_id;
			withdrawnVisitId = withdrawVisitId;
			toastStore.success(
				`${committed.rows_decided} reading${committed.rows_decided === 1 ? '' : 's'} withdrawn`,
			);
			withdrawOpen = false;
			await Promise.all([loadVisits(), refreshVisitDetail(withdrawVisitId)]);
			onDataChanged();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The withdrawal failed');
			withdrawOpen = false;
		} finally {
			withdrawing = false;
		}
	}

	async function undoWithdrawal(id: string) {
		if (!withdrawnSetId) return;
		withdrawing = true;
		try {
			const rolled = await rollbackEditSet(withdrawnSetId);
			withdrawnSetId = '';
			withdrawnVisitId = '';
			toastStore.success(
				`${rolled.rolled_back} reading${rolled.rolled_back === 1 ? '' : 's'} re-asserted`,
			);
			await Promise.all([loadVisits(), refreshVisitDetail(id)]);
			onDataChanged();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The re-assertion failed');
		} finally {
			withdrawing = false;
		}
	}

	// A calculation opened at this visit, on the curve its last run here used: the tools page reads
	// its context from the staged-visit store, so opening one means naming exactly this visit.
	async function openCalculation(tool: string, visit: EventDetailResponse) {
		stagedVisit.set(stagedVisitFrom(visit, siteName ?? ""));
		const run = lastRunOfCalculation(tool, visit.cells);
		const reload = run ? `&reload=${run}&replay=visit` : '';
		await goto(`${base}/data-entry?tool=${encodeURIComponent(tool)}${reload}`);
	}

	function declareInstrument(eventId: string, parameterId: string, sensorId: string) {
		const key = instrumentKey(eventId, parameterId);
		const next = { ...declaredInstruments };
		if (sensorId) next[key] = sensorId;
		else delete next[key];
		declaredInstruments = next;
	}

	async function discardVisit(id: string) {
		if (!window.confirm('Discard this empty visit? This cannot be undone.')) return;
		visitBusy = id;
		try {
			await stagedVisit.discard(id);
			expandedVisit = null;
			await loadVisits();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not discard the visit');
		} finally {
			visitBusy = null;
		}
	}

	// The grid as displayed, one row per visit and one column per parameter code, named by site
	// and date range the way the server names it. The Export dialog is the other file: readings
	// in long format, one row per reading.
	async function downloadVisitsCsv() {
		if (visits.length === 0) return;
		visitsDownloading = true;
		try {
			const day = (iso: string) => iso.slice(0, 10);
			const first = visitsStart ? day(visitsStart) : day(visits[visits.length - 1].collected_at);
			const last = visitsEnd ? day(visitsEnd) : day(visits[0].collected_at);
			const slug = (siteName ?? 'site').replace(/[^A-Za-z0-9]/g, '_');
			await downloadSiteVisitsCsv(siteId, visitsRange(), `${slug}_visits_${first}_${last}.csv`);
		} catch (e) {
			toastStore.error(e instanceof Error ? `Download failed: ${e.message}` : 'Download failed');
		} finally {
			visitsDownloading = false;
		}
	}

	// A curation write from inside an expanded visit's record: re-read the visit in place, without
	// collapsing what the operator has open.
	async function refreshVisitDetail(id: string) {
		try {
			visitDetail = await getCollectionEventDetail(id);
		} catch {
			// The panel reports its own failure; the row keeps what it had.
		}
	}

	async function openVisit(id: string, forceOpen = false, selectParameterId: string | null = null) {
		if (expandedVisit === id && !forceOpen) {
			expandedVisit = null;
			visitDetail = null;
			visitCell = null;
			return;
		}
		expandedVisit = id;
		visitCell = null;
		visitDetail = null;
		visitDetailLoading = true;
		try {
			visitDetail = await getCollectionEventDetail(id);
			const selected = selectParameterId
				? visitDetail.cells.find((c) => c.parameter_id === selectParameterId)
				: null;
			if (selected) visitCell = { parameterId: selected.parameter_id, parameterName: selected.parameter_name };
			slotTableOpen = visitCell === null;
			// A deep link can name a visit outside the current range; the range yields to it.
			if (visitDetail && !visits.some((v) => v.id === id)) {
				visitsStart = null;
				visitsEnd = null;
				visitsLoadedKey = '';
				await loadVisits();
			}
		} catch {
			toastStore.error('Failed to load the visit');
		} finally {
			visitDetailLoading = false;
		}
	}

	let recordEl = $state<HTMLElement | null>(null);
	// The visit-wide slot table: closed when a value opened the visit, since the record of that
	// value is what was asked for, and open when the date did (Q224).
	let slotTableOpen = $state(false);

	// A value cell opens the visit's record on its parameter, below the grid.
	async function openVisitCell(id: string, parameterId: string) {
		if (expandedVisit === id && visitDetail) {
			const c = visitDetail.cells.find((c) => c.parameter_id === parameterId);
			visitCell = c ? { parameterId: c.parameter_id, parameterName: c.parameter_name } : null;
			slotTableOpen = visitCell === null;
		} else {
			await openVisit(id, true, parameterId);
		}
		await tick();
		recordEl?.scrollIntoView({ block: 'nearest' });
	}

	/** The record behind a grid position: the visit on a frozen column, the value on a slot. */
	async function openRecordAt(row: number, column: number) {
		const visit = visits[row];
		if (!visit) return;
		const at = sheetSlot(table, row, column);
		if (at) await openVisitCell(visit.id, at.slot.parameterId);
		else await openVisit(visit.id);
	}

	function visitJobSummary(kind: 'recompute' | 'audit', job: ReprocessingJob): string {
		const counts = (job.detail?.counts ?? {}) as Record<string, number>;
		const parts =
			kind === 'recompute'
				? [
						`${counts.tools_run ?? 0} tool${counts.tools_run === 1 ? '' : 's'} run`,
						`${counts.readings_written ?? 0} written`,
						...(counts.tools_skipped ? [`${counts.tools_skipped} skipped`] : []),
					]
				: [
						`${counts.missing_findings ?? 0} missing`,
						`${counts.stale_findings ?? 0} stale`,
						...(counts.superseded ? [`${counts.superseded} closed`] : []),
					];
		const skipped = (job.detail?.scope as { skipped?: Array<{ tool?: string }> } | undefined)
			?.skipped;
		const named = skipped?.length
			? ` (${skipped.map((sk) => sk.tool ?? '?').join(', ')})`
			: '';
		return `${kind === 'recompute' ? 'Recomputed' : 'Audited'}: ${parts.join(', ')}${named}`;
	}

	// The scoped apply, in one tracked job: the visits at this site with an open finding, or
	// every one the range lists. A calculation authored today has raised no finding anywhere, so
	// the findings arm reaches none of the visits it has to compute at.
	let staleApplyBusy = $state(false);
	const staleVisitCount = $derived(visits.filter((v) => v.recompute === 'stale').length);
	async function applyToVisits(onlyFindings: boolean) {
		staleApplyBusy = true;
		try {
			const r = await runEventRecompute(
				onlyFindings
					? { site_id: siteId, only_findings: true }
					: { site_id: siteId, ...visitsRange(), only_findings: false },
			);
			if (r.job_id) {
				const job = await pollJob(r.job_id);
				if (job.status === 'completed') {
					const counts = (job.detail?.counts ?? {}) as Record<string, number>;
					toastStore.success(
						`Recomputed ${counts.events_recomputed ?? 0} visit${(counts.events_recomputed ?? 0) === 1 ? '' : 's'}: ${counts.tools_run ?? 0} run, ${counts.tools_unchanged ?? 0} unchanged, ${counts.findings_closed ?? 0} finding${(counts.findings_closed ?? 0) === 1 ? '' : 's'} closed`,
					);
				} else {
					toastStore.error(job.error_message ?? 'The recompute job did not complete');
				}
			}
			await loadVisits();
			onDataChanged();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to recompute the visits');
		} finally {
			staleApplyBusy = false;
		}
	}

	// Recompute and audit are tracked jobs: enqueue, poll, then refresh the grid.
	async function runVisitJob(id: string, kind: 'recompute' | 'audit') {
		visitBusy = id;
		try {
			const r =
				kind === 'recompute'
					? await recomputeCollectionEvent(id)
					: await runEventAudit({ collection_event_id: id });
			if (r.job_id) {
				const job = await pollJob(r.job_id);
				if (job.status === 'completed') {
					toastStore.success(visitJobSummary(kind, job));
				} else {
					toastStore.error(job.error_message ?? `The ${kind} job did not complete`);
				}
			}
			await Promise.all([openVisit(id, true, visitCell?.parameterId ?? null), loadVisits()]);
			if (kind === 'recompute') onDataChanged();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : `Failed to ${kind} the visit`);
		} finally {
			visitBusy = null;
		}
	}

	$effect(() => {
		if (!active || !siteId) return;
		const key = `${siteId}|${visitsStart ?? ''}|${visitsEnd ?? ''}`;
		if (key === visitsLoadedKey) return;
		visitsLoadedKey = key;
		untrack(() => {
			void loadVisits();
			if (groups.length === 0) void loadGroups();
		});
	});

	// A ?event= deep link expands its visit once the tab is active; with ?parameter= or ?point= it
	// opens that parameter's record too.
	let consumedEventParam = '';
	$effect(() => {
		if (!active || siteParameters.length === 0) return;
		const ev = page.url.searchParams.get('event');
		if (!ev || ev === consumedEventParam) return;
		consumedEventParam = ev;
		const selectParam = deepLinkParameter(page.url.searchParams, siteParameters);
		untrack(() => void openVisit(ev, true, selectParam));
	});
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

{#snippet calculationBadge(state: string | undefined)}
	{@const badge = visitBadge(state)}
	{#if badge}
		<Badge variant={badge.variant}>{badge.label}</Badge>
	{/if}
{/snippet}

{#snippet visitState(unverified: boolean | undefined, withdrawnAt: string | null | undefined)}
	{@const state = verificationBadge(unverified, withdrawnAt)}
	{#if state}
		<Badge variant={state.variant}>{state.label}</Badge>
	{/if}
{/snippet}

			<div class="space-y-3">
				{#if barSpan}
					<TimeRangeSlider
						min={barSpan.min}
						max={barSpan.max}
						bind:start={sliderStart}
						bind:end={sliderEnd}
						onchange={onVisitsRangeDragged}
					/>
				{/if}
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<label for="visits-start" class="text-xs text-brand-muted block mb-1">From</label>
						<TimestampInput
							id="visits-start"
							compact
							value={visitsStart ?? ''}
							onchange={(instant) => (visitsStart = instant || null)}
						/>
					</div>
					<div>
						<label for="visits-end" class="text-xs text-brand-muted block mb-1">To</label>
						<TimestampInput
							id="visits-end"
							compact
							value={visitsEnd ?? ''}
							onchange={(instant) => (visitsEnd = instant || null)}
						/>
					</div>
					{#if visitsStart || visitsEnd}
						<Button size="sm" onclick={() => { visitsStart = null; visitsEnd = null; }}>All dates</Button>
					{/if}
					{#if groups.length > 0 || siteCalculations.length > 0}
						<div>
							<label for="visits-group" class="text-xs text-brand-muted block mb-1">Parameter group</label>
							<select
								id="visits-group"
								bind:value={groupFilter}
								class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
								title="Narrow the table to one group, or to the inputs and outputs of one calculation. Every parameter the site is assigned keeps its column either way."
							>
								<option value="">All groups</option>
								{#each groups as group (group.id)}
									<option value={group.id}>{group.label}</option>
								{/each}
								{#if groups.length > 0}
									<option value="none">Ungrouped</option>
								{/if}
								{#if siteCalculations.length > 0}
									<optgroup label="Calculations">
										{#each siteCalculations as tool (tool)}
											<option value={`${CALCULATION_FILTER}${tool}`}>{toolLabel(tool)}</option>
										{/each}
									</optgroup>
								{/if}
							</select>
						</div>
					{/if}
					{#if me.can('enterFieldData')}
						<Button size="sm" variant="primary" onclick={() => (newVisitOpen = true)}>New visit</Button>
						<NewVisitDialog bind:open={newVisitOpen} {siteId} onadded={() => loadVisits()} />
					{/if}
					<span class="text-sm text-brand-muted">{visits.length} visit{visits.length === 1 ? '' : 's'}{visitsStart || visitsEnd ? ' in range' : ''}</span>
					<span class="ml-auto flex items-center gap-1">
						<Button
							size="sm"
							variant="secondary"
							disabled={visitsDownloading || visits.length === 0}
							onclick={downloadVisitsCsv}
						>
							{visitsDownloading ? 'Downloading…' : 'Download grid CSV'}
						</Button>
						<InfoTip
							text="This grid as displayed: one row per visit, one column per parameter code, the served value in each cell. For the readings themselves in long format (one row per reading, replicates and flags included) use Export."
						/>
					</span>
				</div>
				{#if visitsLoading && visits.length === 0}
					<p class="text-sm text-brand-muted">Loading…</p>
				{:else if visits.length === 0}
					<p class="text-sm text-brand-muted">{visitsStart || visitsEnd ? 'No visits in this range.' : 'No visits recorded for this site.'}</p>
				{:else}
					{#if me.can('writeData')}
						<div class="flex items-center gap-2">
							<Button
								size="sm"
								variant="secondary"
								disabled={staleApplyBusy}
								title="Recompute every visit at this site with an open missing- or stale-output finding, in one tracked job. Unchanged calculations are skipped; the findings a run repairs close with it."
								onclick={() => applyToVisits(true)}
							>
								{staleApplyBusy ? 'Recomputing…' : `Recompute stale visits${staleVisitCount > 0 ? ` (${staleVisitCount} listed)` : ''}`}
							</Button>
							<ConfirmPopover
								message={`Run every calculation declared at this site at ${visits.length} visit${visits.length === 1 ? '' : 's'}${visitsStart || visitsEnd ? ' in this range' : ''}, whether or not a finding was raised there. A calculation that has never run here computes its outputs for the first time; one whose inputs and version are unchanged is left alone.`}
								confirmLabel="Compute"
								confirmVariant="primary"
								onconfirm={() => applyToVisits(false)}
							>
								<Button
									size="sm"
									variant="secondary"
									disabled={staleApplyBusy}
									title="Compute a newly authored calculation at the visits already entered: every listed visit is recomputed, not only those with an open finding."
								>
									Compute at listed visits
								</Button>
							</ConfirmPopover>
						</div>
					{/if}
					{#if me.can('enterFieldData')}
						<div class="flex flex-wrap items-center gap-2">
							{#if typing}
								<Button
									size="sm"
									variant="secondary"
									disabled={screened}
									loading={checking}
									title="Screen what you have entered or corrected against this site's seasonal distribution. A save is held to exactly the values its check covered."
									onclick={runChecks}
								>{checking ? 'Checking…' : screened ? 'Checked' : 'Check against site history'}</Button>
							{/if}
							<Button
								size="sm"
								variant="secondary"
								title="One more row under the table, to open a visit at a date this site has none at"
								onclick={() => (askedSpares = spares.length + 1)}
							>Add a row</Button>
							<label class="flex items-center gap-1.5 text-xs text-brand-muted">
								New rows dated in
								<select
									aria-label="Zone new rows are dated in"
									value={readZone}
									onchange={(e) => (pickedZone = e.currentTarget.value)}
									class="max-w-[12rem] rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-xs"
								>
									{#each zones as zone (zone.value)}
										<option value={zone.value}>{zone.label}</option>
									{/each}
								</select>
								<span class="tabular-nums">{readOffset} applied</span>
							</label>
							<Button
								size="sm"
								variant="primary"
								disabled={(moved === 0 && newVisits.length === 0) || !screened}
								title={moved > 0 && !screened ? 'Check these values against the site history first' : undefined}
								onclick={askToSave}
							>{saveLabel(moved, newVisits.length)}</Button>
							{#if moved > 0 || newVisits.length > 0}
								<Button
									size="sm"
									variant="ghost"
									onclick={undoEdit}
									disabled={!canUndo}
									title="Undo the last change you typed or pasted (Ctrl+Z). Nothing is written until Save."
								>Undo</Button>
								<Button size="sm" variant="ghost" onclick={discardEdits}>Discard what you typed</Button>
							{/if}
							{#if saveRefusal}
								<span class="text-xs text-severity-alarm">{saveRefusal}</span>
							{/if}
							{#if pasteRefusal}
								<span class="text-xs text-severity-warning-text">{pasteRefusal}</span>
							{/if}
							{#if spareRefusal}
								<span class="text-xs text-severity-alarm">{spareRefusal}</span>
							{/if}
							{#if previewLine}
								<span class="text-xs text-brand-muted">{previewLine}</span>
							{/if}
							{#if runReport}
								<span class="text-xs text-brand-muted">{runReport}</span>
							{/if}
						</div>
						{#if lastSave.length > 0}
							<div class="flex flex-wrap items-center gap-2 text-xs text-brand-muted" data-save-recovery>
								<span>Saved over stored values. To put them back:</span>
								{#each lastSave as visit (visit.eventId)}
									<Button size="sm" variant="ghost" onclick={() => askToRollBackSave(visit)}
										>Roll back the save at {formatDateTime(visit.collectedAt)}</Button
									>
								{/each}
								<span>Each value's own history also rolls it back on its own.</span>
							</div>
						{/if}
						{#if seasonalFindings.length > 0}
							<div class="flex flex-col gap-0.5">
								{#each seasonalFindings as finding (finding.parameterId + finding.text)}
									<span class="text-xs text-severity-warning-text">{finding.text}</span>
								{/each}
							</div>
						{/if}
					{/if}
					<SheetGrid data={gridData} settings={gridSettings} onready={gridReady} class="text-sm" />
					{#if expandedVisit}
						{@const v = { id: expandedVisit }}
						<div class="rounded-md border border-brand-divider bg-brand-bg/50 px-4 py-3">
						{#if visitDetailLoading}
							<p class="text-xs text-brand-muted">Loading…</p>
						{:else if visitDetail}
							{@const counts = visitCounts(visitDetail.cells)}
							<div class="mb-2 flex items-center justify-between gap-2">
								<div class="text-xs text-brand-muted">
									<span class="font-mono text-brand-text">
										{visits.find((visit) => visit.id === expandedVisit)?.parameters_filled ?? counts.parameters}/{groupColumns.length} parameters filled · {counts.replicates} replicate{counts.replicates === 1 ? '' : 's'} · {counts.flagged} flagged · {counts.withdrawn} withdrawn · {counts.findings} finding{counts.findings === 1 ? '' : 's'}
									</span>
									·
									{visitSourceLabel(visitDetail.source, visitDetail.created_by)}
									{#if verificationNoticeFor(visitDetail.unverified, visitDetail.withdrawn_at)}. {verificationNoticeFor(visitDetail.unverified, visitDetail.withdrawn_at)}{/if}
									{#if visitDetail.notes}· {visitDetail.notes}{/if}
									{@render calculationBadge(visitDetail.recompute)}
									{@render visitState(visitDetail.unverified, visitDetail.withdrawn_at)}
								</div>
								{#if me.can('enterFieldData')}
									<div class="flex gap-2">
										{#if me.can('writeFieldMetadata') && visitDetail.cells.length === 0}
											<Button variant="danger" size="sm" disabled={visitBusy === v.id} onclick={(e) => { e.stopPropagation(); discardVisit(v.id); }}>Discard this visit</Button>
										{/if}
										{#if me.can('writeData') && !visitDetail.withdrawn_at && visitDetail.cells.length > 0}
											<Button
												variant="danger"
												size="sm"
												disabled={withdrawing}
												title="Withdraw every reading this visit holds. A withdrawal is a reversible stamp, not a delete."
												onclick={(e) => { e.stopPropagation(); void askToWithdraw(v.id); }}
											>Withdraw this visit</Button>
										{/if}
										{#if withdrawnSetId && withdrawnVisitId === v.id}
											<Button
												variant="secondary"
												size="sm"
												disabled={withdrawing}
												onclick={(e) => { e.stopPropagation(); void undoWithdrawal(v.id); }}
											>Undo the withdrawal</Button>
										{/if}
										{#if me.can('writeData')}
										<Button
											size="sm"
											variant="secondary"
											disabled={visitBusy === v.id}
											onclick={(e) => { e.stopPropagation(); runVisitJob(v.id, 'recompute'); }}
										>{visitBusy === v.id ? 'Working…' : 'Recompute tools'}</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={visitBusy === v.id}
											onclick={(e) => { e.stopPropagation(); runVisitJob(v.id, 'audit'); }}
										>Audit this visit</Button>
										{/if}
									</div>
								{/if}
							</div>
							{#if visitCell}
								<div bind:this={recordEl}>
									<PointInspector
										siteId={siteId}
										parameterId={visitCell.parameterId}
										parameterName={visitCell.parameterName}
										units={unitsForParameter(visitCell.parameterId)}
										decimals={decimalsForParameter(visitCell.parameterId)}
										timeIso={visitDetail.collected_at}
										measurementType="spot"
										preloaded={cellRecord(visitDetail, visitCell.parameterId)}
										link={visitPointLink(v.id, visitCell.parameterId)}
										onclose={() => (visitCell = null)}
										onchange={() => void refreshVisitDetail(v.id)}
										onflag={(reps) => openVisitFlag(v.id, reps)}
									/>
								</div>
							{/if}
							{@const rows = recordRows(visitDetail.cells, visitColumns)}
							<button
								type="button"
								class="mt-2 cursor-pointer border-none bg-transparent p-0 text-xs text-brand-primary hover:underline"
								aria-expanded={slotTableOpen}
								onclick={() => (slotTableOpen = !slotTableOpen)}
							>{slotTableLabel(slotTableOpen, rows)}</button>
							{#if slotTableOpen}
								<table class="w-full text-xs">
									<thead class="text-brand-muted">
										<tr>
											<th class="py-1 pr-3 text-left font-medium">Parameter</th>
											<th class="py-1 pr-3 text-left font-medium">Served</th>
											<th class="py-1 pr-3 text-left font-medium">Replicates</th>
											<th class="py-1 pr-3 text-left font-medium">Curve</th>
											<th class="py-1 pr-3 text-left font-medium">Provenance</th>
											<th class="py-1 text-left font-medium">Finding</th>
										</tr>
									</thead>
									<tbody>
										{#each recordRows(visitDetail.cells, visitColumns) as row (row.parameterId + (row.cell?.stream_id ?? 'unmeasured'))}
											{@const cell = row.cell}
											<tr
												class="border-t border-brand-divider/60 {cell ? 'cursor-pointer hover:bg-brand-bg/60' : ''} {visitCell?.parameterId === row.parameterId ? 'bg-brand-bg' : ''}"
												aria-selected={visitCell?.parameterId === row.parameterId}
												onclick={() => { if (cell) visitCell = { parameterId: cell.parameter_id, parameterName: cell.parameter_name }; }}
											>
												<td class="py-1 pr-3">
													{#if cell}
														<button
															type="button"
															class="cursor-pointer border-none bg-transparent p-0 text-left text-inherit hover:underline"
															aria-pressed={visitCell?.parameterId === row.parameterId}
															onclick={() => (visitCell = { parameterId: cell.parameter_id, parameterName: cell.parameter_name })}
														>{cell.parameter_name}</button>
													{:else}
														<span class="text-brand-muted">{row.parameterName}</span>
													{/if}
													{#if unitsForParameter(row.parameterId)}<span class="text-brand-muted">({unitsForParameter(row.parameterId)})</span>{/if}
													{#if me.can('writeData') && !cell?.written_by && instruments.length > 0}
														{@const declared = declaredInstruments[instrumentKey(v.id, row.parameterId)] ?? ''}
														<select
															class="ml-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] hover:border-brand-divider"
															title="What measured this parameter at this visit. It is stored on every value entered here."
															aria-label="Instrument for {row.parameterName} at this visit"
															value={declared}
															onclick={(e) => e.stopPropagation()}
															onchange={(e) => declareInstrument(v.id, row.parameterId, e.currentTarget.value)}
														>
															<option value="">Undeclared</option>
															{#each pickerOptions(instruments, declared || undefined) as sensor (sensor.id)}
																<option value={sensor.id}
																	>{sensor.name ?? sensor.serial_number ?? sensor.id.slice(0, 8)}{retiredSuffix(sensor)}</option
																>
															{/each}
														</select>
														{@const curves = instrumentCurves(declared, curveRefs.curveCount(declared))}
														{#if curves}
															<a
																class="ml-1 text-[10px] text-brand-primary hover:underline"
																href="{base}{curves.href}"
																title="The standard curves of the instrument declared here"
																onclick={(e) => e.stopPropagation()}
															>{curves.label}</a>
														{/if}
													{/if}
													{#if cell && cellRole(cell).title}
														{@const owner = cellRole(cell).role === 'output' ? cell.written_by : (cell.read_by ?? [])[0]}
														<button
															type="button"
															class="ml-1.5 cursor-pointer rounded border-none px-1 text-[10px] {cellRole(cell).role === 'output'
																? 'bg-brand-accent/15 text-brand-accent-dark'
																: 'bg-brand-primary/10 text-brand-primary'}"
															title={[cellRole(cell).title, owner ? `Open ${owner} at this visit, on the curve its last run here used` : null].filter(Boolean).join('\n')}
															onclick={(e) => { e.stopPropagation(); if (owner) void openCalculation(owner, visitDetail!); }}
														>{cellRole(cell).role === 'output' ? cell.written_by : `→ ${(cell.read_by ?? []).join(', ')}`}</button>
													{/if}
												</td>
												{#if !cell}
													<!-- A slot the site declares and the visit did not measure. It has a row so a
													     first measurement can say what took it (U69). -->
													<td class="py-1 pr-3 text-brand-muted">-</td>
													<td class="py-1 pr-3 text-brand-muted">-</td>
													<td class="py-1 pr-3 text-brand-muted">-</td>
													<td class="py-1 pr-3 text-brand-muted">not measured</td>
													<td class="py-1 text-brand-muted">-</td>
												{:else}
												<td class="py-1 pr-3 tabular-nums">
													{formatMeasurement(cell.served_value, decimalsForParameter(cell.parameter_id))}
													{#if cell.sample && cell.sample.n >= 2 && cell.sample.stdev != null}
														<span
															class="text-brand-muted"
															title={statisticsParts(
																cell.sample,
																decimalsForParameter(cell.parameter_id),
																unitsForParameter(cell.parameter_id)
															).join('\n')}
														>±{formatMeasurement(cell.sample.stdev, decimalsForParameter(cell.parameter_id))} (n={cell.sample.n})</span>
													{/if}
												</td>
												<td class="py-1 pr-3 tabular-nums text-brand-muted">
													{cell.replicates
														.map((r) => `${formatMeasurement(r.calibrated_value ?? r.raw_value, decimalsForParameter(cell.parameter_id))}${r.flagged ? '*' : ''}${r.withdrawn ? '†' : ''}`)
														.join(', ')}
												</td>
												<td class="py-1 pr-3">
													{#each cellCurves(cell, base) as curve, i (curve.id)}
														{#if i > 0}<span class="text-brand-muted">, </span>{/if}
														{@const title = `${curve.computed ? 'Computed with' : 'Corrected with'} ${curve.label}: ${curve.equation}${curve.retired ? ', retired' : ''}`}
														{#if curve.target.kind === 'calculation'}
															{@const tool = curve.target.tool}
															{#if curve.computed}<span class="text-brand-muted">computed with </span>{/if}
															<button
																type="button"
																class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
																title="{title}. Open {tool} at this visit, on the curve its last run here used"
																onclick={(e) => { e.stopPropagation(); void openCalculation(tool, visitDetail!); }}
															>{curve.label}</button>{#if curve.computed}{' '}<span class="text-brand-muted">({curve.equation})</span>{/if}
														{:else}
															<a
																class="text-brand-primary hover:underline"
																href={curve.target.href}
																title="{title}. Open this standard curve on the lab instrument"
																onclick={(e) => e.stopPropagation()}
															>{curve.label}</a>
														{/if}
													{:else}
														<span class="text-brand-muted">-</span>
													{/each}
												</td>
												<td class="py-1 pr-3 relative">
													{#if cell.has_provenance && cell.tool_run_id}
														{@const key = `${cell.parameter_id}:${cell.stream_id}`}
														{@const runId = cell.tool_run_id}
														<button
															type="button"
															class="cursor-pointer"
															title="Show the calculation"
															aria-label="Show how {cell.tool ?? 'the tool run'} computed this value"
															aria-expanded={equationCell === key}
															onclick={() => toggleEquation(key, runId)}
														><Badge variant="ok">{cell.tool ?? 'tool run'}</Badge></button>
														{#if equationCell === key}
															{@const trace = traces.get(runId)}
															<div
																class="absolute z-40 left-0 top-full mt-1 bg-brand-surface border border-brand-divider rounded-md shadow-lg p-3 min-w-[260px] max-w-md w-max"
															>
																{#if trace === undefined}
																	<p class="text-xs text-brand-muted">Loading…</p>
																{:else if typeof trace === 'string'}
																	<p class="text-xs text-brand-muted">{trace}</p>
																{:else}
																	<p class="text-xs font-semibold mb-2">{trace.label} <span class="font-normal text-brand-muted">version {trace.version_no}</span></p>
																	<CellEquation
																		steps={trace.trace}
																		code={cell.parameter_code}
																		walk
																		origin={inputOrigin(trace, formatDateTime)}
																	/>
																{/if}
															</div>
														{/if}
													{:else if cell.has_provenance}
														<Badge variant="ok">{cell.tool ?? 'tool run'}</Badge>
													{:else}
														<span class="text-brand-muted">{rowProvenanceLabel(cell.provenance_kind, cell.source_system) ?? 'unknown origin'}</span>
													{/if}
												</td>
												<td class="py-1">
													{#if cell.finding}
														<Badge variant="warning">{findingLabel(cell.finding.kind)}</Badge>
													{:else}
														<span class="text-brand-muted">-</span>
													{/if}
												</td>
												{/if}
											</tr>
										{/each}
									</tbody>
								</table>
								{#if visitDetail.cells.some((c) => c.replicates.some((r) => r.flagged || r.withdrawn))}
									<p class="mt-1 text-[11px] text-brand-muted">* flagged · † withdrawn at source · ? pending verification</p>
								{/if}
							{/if}
						{/if}
						</div>
					{/if}
					{#if visits.some((v) => v.cells.some((c) => visitCellMarker(c)))}
						<p class="text-[11px] text-brand-muted">* flagged · † withdrawn at source · ? pending verification</p>
					{/if}
					{#if visits.some((v) => v.cells.some((c) => visitCellCurveMark(c)))}
						<p class="text-[11px] text-brand-muted">c corrected with a standard curve, named on hover</p>
					{/if}
					{#if visits.some((v) => v.cells.some((c) => visitCellComputedCurveMark(c)))}
						<p class="text-[11px] text-brand-muted">f computed with a standard curve by its calculation, named on hover</p>
					{/if}
				{/if}
			</div>

<Dialog bind:open={confirmOpen} title="Save what you typed" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-2 text-sm">
			<p>
				{moved} value{moved === 1 ? '' : 's'} will be written across {writes.length} visit{writes.length === 1 ? '' : 's'},
				{writes.reduce((n, w) => n + w.corrections.length, 0)} corrected in place{#if withdrawn > 0}, {withdrawn} withdrawn{/if}.
			</p>
			{#if newVisits.length > 0}
				<p>
					{newVisits.length} new visit{newVisits.length === 1 ? '' : 's'} will be opened at this site:
					{newVisits.map((v) => formatDateTime(v.collectedAt)).join(', ')}.
				</p>
			{/if}
			{#if withdrawn > 0}
				<p class="text-brand-muted">
					A cleared cell withdraws its replicate: a reversible stamp, not a delete. The reading stays on
					the record and can be re-asserted.
				</p>
			{/if}
			{#if consequence}
				<p class="text-brand-muted">{consequence}</p>
			{/if}
			{#each seasonalFindings as finding (finding.parameterId + finding.text)}
				<p class="text-xs text-severity-warning-text">{finding.text}</p>
			{/each}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="secondary" onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button variant="primary" loading={saving} onclick={saveTable}>
			{saving ? 'Saving…' : 'Save'}
		</Button>
	{/snippet}
</Dialog>

{#if saveRecovery}
	<RollbackDialog
		bind:open={saveRecoveryOpen}
		title="Roll back the save at {formatDateTime(saveRecovery.visit.collectedAt)}"
		lines={saveRecovery.lines}
		loading={saveRecovery.loading}
		busy={rollingBackSave}
		error={saveRecovery.error}
		note={saveRecovery.visit.entered
			? 'A value typed into a replicate that held none is a new reading, not part of this edit: clear the cell to withdraw it.'
			: null}
		onconfirm={rollBackSave}
	/>
{/if}

<Dialog bind:open={withdrawOpen} title="Withdraw this visit" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-2 text-sm">
			<p>
				{withdrawRows} reading{withdrawRows === 1 ? '' : 's'} will be withdrawn. A withdrawal is a
				reversible stamp, not a delete: the readings stay on the record and can be re-asserted.
			</p>
			{#if withdrawConsequence}
				<p class="text-brand-muted">{withdrawConsequence}</p>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="secondary" onclick={() => (withdrawOpen = false)}>Cancel</Button>
		<Button variant="danger" loading={withdrawing} onclick={withdrawVisit}>
			{withdrawing ? 'Withdrawing…' : 'Withdraw'}
		</Button>
	{/snippet}
</Dialog>
