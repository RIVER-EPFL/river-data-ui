<script lang="ts">
	// The Visits tab: the portal's wide data row, one per (site, date), with the per-visit grid
	// under an expanded row. The page hosts it and owns the flag dialog it opens.
	import { tick, untrack } from 'svelte';
	import { downloadBlob } from '$lib/download';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { me } from '$auth/me.svelte';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { goto } from '$app/navigation';
	import { rowProvenanceLabel } from '$lib/origin';
	import { stagedVisitFrom } from '$lib/visits/grid';
	import { lastRunOfCalculation } from '$lib/tools/visitPrefill';
	import { pickerOptions, retiredSuffix } from '$lib/instruments/kind';
	import {
		api,
		type SiteParameter,
		type ReprocessingJob,
		type ParameterGroup,
		type Sensor,
	} from '$api/crud';
	import {
		listSiteVisits,
		saveGrabSample,
		previewEdit,
		commitEdit,
		rollbackEditSet,
		getCalculationClosure,
		seasonalCheck,
		getCollectionEventDetail,
		recomputeCollectionEvent,
		runEventAudit,
		runEventRecompute,
		pollJob,
		type VisitRow,
		type VisitsResponse,
		type EventDetailResponse,
	} from '$api/service';
	import type { SampleReplicate } from '$lib/api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { formatMeasurement } from '$lib/format';
	import {
		cellRecord,
		estimatorWord,
		findingLabel,
		statisticsParts,
		visitCellMarker,
		visitCellStatistics,
		visitCounts,
	} from '$lib/visits/cell';
	import {
		SYNCED_VISIT_NOTICE,
		entryNoticeFor,
		visitBadge,
		visitSourceLabel,
	} from '$lib/visits/recompute';
	import { verificationBadge, verificationNoticeFor } from '$lib/visits/verification';
	import { holdInPlace } from '$lib/visits/anchor';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import PointInspector from '$components/provenance/PointInspector.svelte';
	import {
		askedWidth,
		columnSpan,
		columnsInGroup,
		expandable,
		parameterColumns,
		slotsOf,
		toggled,
	} from '$lib/visits/columns';
	import { at, bounds, covers, isGridKey, nextCell, onFocusMoved, type Selection } from '$lib/visits/keys';
	import {
		checkSatisfied,
		checkSignature,
		correctionKeys,
		editable,
		entryValues,
		expectedReplicates,
		pendingCount,
		pendingWrites,
		setCell,
		slotKey,
		storedAt,
		instrumentKey,
		applyPaste,
		copyBlock,
		pasteNotice,
		type Edits,
	} from '$lib/visits/tableEdit';
	import { empty, push, undo } from '$lib/visits/history';
	import { cellRole, cellWritable, editConsequence } from '$lib/visits/role';
	import { seasonalFindingLabel } from '$lib/seasonal';
	import { runOutputs, runReportLine } from '$lib/visits/recompute';
	import Dialog from '$components/ui/Dialog.svelte';
	import { browserLocale, writeNumber } from '$lib/visits/number';
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
	let visits = $state<VisitRow[]>([]);
	let visitColumns = $state<VisitsResponse['expected_parameters']>([]);
	let visitsLoading = $state(false);
	let visitsLoadedKey = '';
	let expandedVisit = $state<string | null>(null);
	let visitDetail = $state<EventDetailResponse | null>(null);
	let visitDetailLoading = $state(false);
	let visitBusy = $state<string | null>(null);
	let visitCell = $state<{ parameterId: string; parameterName: string } | null>(null);

	// The date range filter. Unset lists every visit at the site, which is the default: a
	// station holds tens of visits, and the page devoted to them lists them all.
	let visitsStart = $state<string | null>(null);
	let visitsEnd = $state<string | null>(null);
	let visitsDownloading = $state(false);
	// Which parameters are open to their repeats. Per table, not per row: every visit shows the
	// same columns, so a value stays under its own header.
	// The parameter groups the site's slots belong to, so the table narrows to one the way the
	// entry grid does. Loaded once with the tab, not per visit.
	let groups = $state<ParameterGroup[]>([]);
	let groupOf = $state<Record<string, string>>({});
	let groupFilter = $state('');

	async function loadGroups() {
		try {
			const [groupRows, members, sensors] = await Promise.all([
				api.parameterGroups.list({ perPage: 200, sort: ['ordinal', 'ASC'] }),
				api.parameterGroupMembers.list({ perPage: 1000 }),
				api.sensors.list({ perPage: 500, sort: ['name', 'ASC'] }),
			]);
			groups = groupRows.data;
			groupOf = Object.fromEntries(members.data.map((m) => [m.parameter_id, m.group_id]));
			instruments = sensors.data;
		} catch {
			// These are affordances; without them the table still lists and saves.
		}
	}

	let expandedColumns = $state<Set<string>>(new Set());
	// Repeats the operator has asked a group for, past what the store holds. A field day that took
	// a fourth measurement needs the column before it can hold the value.
	let askedColumns = $state<Map<string, number>>(new Map());
	const groupColumns = $derived(
		columnsInGroup(
			parameterColumns(visitColumns, visits, expandedColumns, askedColumns),
			groupOf,
			groupFilter,
		),
	);


	// Typing into the table. One Save writes every visit it touched; the model that decides what a
	// cell is (a correction keyed on its stream, or an entry rewriting its group) is `tableEdit`.
	const locale = browserLocale();
	let edits = $state<Edits>({});
	let saving = $state(false);
	let saveRefusal = $state('');
	// A cell reads at its slot's declared precision until the keyboard is in it, and then at the
	// number the store holds: the table's display decision and the entry grid's "reads back as it
	// was typed" are both kept, and no incidental keystroke rounds a stored value.
	let focusedSlot = $state<string | null>(null);
	// Every edit replaces `edits` wholesale, so the object it replaced is the snapshot (M117).
	let editHistory = $state(empty<Edits>());
	// One screening per visit entering a value: the server holds each save to exactly the values
	// its own check covered, and a visit's check re-arms when that visit's entries move.
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

	const writes = $derived(pendingWrites(visits, edits, locale, declaredInstruments));
	// The grid the keyboard walks: a visit down, a (parameter, replicate) slot across. The moving
	// itself is `keys`, which is pure over the dimensions and what is navigable.
	const slots = $derived(slotsOf(groupColumns));
	let focused = $state<Selection | null>(null);
	let dragging = $state(false);
	/** What a paste left behind, held on screen until the next one rather than passed as a toast. */
	let pasteRefusal = $state<string | null>(null);

	function navigable(row: number, column: number): boolean {
		const visit = visits[row];
		const slot = slots[column];
		if (!visit || !slot) return false;
		if (!me.can('writeData') || !editable(slot.column)) return false;
		return slotWritable(visit, slot.parameterId, slot.replicateIndex).writable;
	}

	function focusCell(selection: Selection) {
		focused = selection;
		document.getElementById(`visit-cell-${selection.row}-${selection.column}`)?.focus();
	}

	function onCellKey(event: KeyboardEvent, row: number, column: number) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			undoEdit();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
			copySelection(event);
			return;
		}
		if (!isGridKey(event.key)) return;
		const next = nextCell(
			focused ?? at(row, column),
			event.key,
			{ rows: visits.length, columns: slots.length },
			navigable,
			event.shiftKey,
		);
		if (!next) return;
		event.preventDefault();
		focusCell(next);
	}

	// Dragging extends the selection the way a sheet does: press on the cell the block starts at,
	// and every cell the pointer crosses while it is held moves the far corner.
	function startDrag(row: number, column: number) {
		dragging = true;
		focused = at(row, column);
	}

	function extendDrag(row: number, column: number) {
		if (!dragging || !focused) return;
		focused = { ...focused, row, column };
	}

	// A block copies out in the layout a paste reads back, so a spreadsheet takes the dates the way
	// it gave them. A selection of one cell is left to the input under the cursor, where copying
	// part of a value is what the operator means.
	function copySelection(event: KeyboardEvent) {
		if (!focused) return;
		const block = bounds(focused);
		if (block.height * block.width === 1) return;
		event.preventDefault();
		const text = copyBlock(visits, slots, edits, block, (value) =>
			writeNumber(value, locale),
		);
		navigator.clipboard?.writeText(text).catch(() => {});
	}

	function onCellPaste(event: ClipboardEvent, row: number, column: number) {
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (!text.includes('\t') && !text.includes('\n')) return;
		event.preventDefault();
		editHistory = push(editHistory, edits);
		const pasted = applyPaste(visits, slots, edits, row, column, text, locale);
		edits = pasted.edits;
		pasteRefusal = pasteNotice(pasted);
	}

	/** Whether the selection stands on this cell, for the ring that draws the block. */
	function selected(row: number, column: number): boolean {
		return focused !== null && covers(focused, row, column);
	}

	/** Where a cell sits in the grid the keyboard walks. */
	function cellPosition(row: number, parameterId: string, replicateIndex: number) {
		return {
			row,
			column: slots.findIndex(
				(slot) => slot.parameterId === parameterId && slot.replicateIndex === replicateIndex,
			),
		};
	}
	const screened = $derived(checkSatisfied(writes, checks));
	const entering = $derived(writes.some((w) => w.entries.length > 0));
	const moved = $derived(pendingCount(edits, locale));

	function cellDisplay(key: string, value: number | null, decimals: number | null): string {
		if (key in edits) return edits[key];
		if (value === null) return '';
		return focusedSlot === key ? writeNumber(value, locale) : formatMeasurement(value, decimals);
	}

	function typeCell(visit: VisitRow, parameterId: string, replicateIndex: number, raw: string) {
		editHistory = push(editHistory, edits);
		edits = setCell(edits, visit, parameterId, replicateIndex, raw, locale);
	}

	function undoEdit() {
		const previous = undo(editHistory);
		if (!previous) return;
		editHistory = previous.history;
		edits = previous.value;
	}

	function onTableKey(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
		event.preventDefault();
		undoEdit();
	}

	/** Whether this account may type over what the store holds at this slot (Q21). */
	function slotWritable(visit: VisitRow, parameterId: string, replicateIndex: number) {
		return cellWritable(me.level, storedAt(visit, parameterId, replicateIndex)?.value ?? null);
	}

	// The site history each visit's entries are screened against, one call per visit entering a
	// value. Nothing is screened for a save that only corrects: a correction moves a value the
	// site already holds.
	async function runChecks() {
		checking = true;
		seasonalFindings = [];
		try {
			const found: { parameterId: string; text: string }[] = [];
			for (const write of writes) {
				if (write.entries.length === 0) continue;
				const response = await seasonalCheck({
					site_id: siteId,
					time: write.collectedAt,
					values: entryValues(write),
				});
				checks = {
					...checks,
					[write.eventId]: { id: response.check_id, signature: checkSignature(write) },
				};
				for (const finding of response.findings) {
					found.push({
						parameterId: finding.parameter_id,
						text: seasonalFindingLabel(finding, paramName(finding.parameter_id)),
					});
				}
			}
			seasonalFindings = found;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The check did not run');
		} finally {
			checking = false;
		}
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

	// What a save would recompute, read from a preview of its corrections rather than guessed.
	async function askToSave() {
		consequence = null;
		runReport = null;
		const keys = correctionKeys(writes);
		if (keys.length > 0) {
			try {
				const preview = await previewEdit(
					{ keys },
					{ kind: 'value_correction', reason: 'corrected in the visits table' },
				);
				consequence = editConsequence(preview.calculations, servedByCode);
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
			for (const write of writes) {
				if (write.corrections.length > 0) {
					const selection = {
						keys: write.corrections.map((c) => ({
							stream_id: c.streamId,
							time: write.collectedAt,
							replicate_index: c.replicateIndex,
							value: c.value,
						})),
					};
					const decision = {
						kind: 'value_correction' as const,
						reason: 'corrected in the visits table',
					};
					const preview = await previewEdit(selection, decision);
					await commitEdit(selection, decision, preview.preview_id);
				}
				if (write.entries.length > 0) {
					const visit = visits.find((v) => v.id === write.eventId)!;
					await saveGrabSample({
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
						...(checks[write.eventId]?.signature === checkSignature(write)
							? { check_id: checks[write.eventId].id }
							: {}),
					});
				}
			}
			toastStore.success(`${moved} value${moved === 1 ? '' : 's'} saved`);
			edits = {};
			editHistory = empty();
			checks = {};
			seasonalFindings = [];
			confirmOpen = false;
			await loadVisits();
			runReport = runReportLine(runOutputs(expected, before, servedNow(), findingByCode()));
			onDataChanged();
		} catch (e) {
			saveRefusal = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
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
			visits = r.visits;
			visitColumns = r.expected_parameters;
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
		await goto(`${base}/tools?tool=${encodeURIComponent(tool)}${reload}`);
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
			const { auth } = await import('$auth/keycloak.svelte');
			await auth.ensureToken();
			const params = new URLSearchParams({ format: 'csv', ...visitsRange() });
			const response = await fetch(`/api/sites/${siteId}/visits?${params}`, {
				headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => response.statusText);
				throw new Error(`${response.status}: ${detail.slice(0, 200)}`);
			}
			const day = (iso: string) => iso.slice(0, 10);
			const first = visitsStart ? day(visitsStart) : day(visits[visits.length - 1].collected_at);
			const last = visitsEnd ? day(visitsEnd) : day(visits[0].collected_at);
			const slug = (siteName ?? 'site').replace(/[^A-Za-z0-9]/g, '_');
			downloadBlob(await response.blob(), `${slug}_visits_${first}_${last}.csv`);
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

	// A cell of the wide table is the click target: it expands the visit and selects the parameter,
	// so the record opens on what was clicked. Opening one closes whatever row was open above it,
	// so the clicked cell is held where it sits and the record is brought just into view.
	async function openVisitCell(id: string, parameterId: string, clicked: HTMLElement) {
		const hold = holdInPlace(clicked);
		if (expandedVisit === id && visitDetail) {
			const c = visitDetail.cells.find((c) => c.parameter_id === parameterId);
			visitCell = c ? { parameterId: c.parameter_id, parameterName: c.parameter_name } : null;
		} else {
			await openVisit(id, true, parameterId);
		}
		await tick();
		hold();
		recordEl?.scrollIntoView({ block: 'nearest' });
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

	// A ?event= deep link expands its visit once the tab is active; with ?point= it opens that
	// parameter's record too.
	let consumedEventParam = '';
	$effect(() => {
		if (!active || siteParameters.length === 0) return;
		const ev = page.url.searchParams.get('event');
		if (!ev || ev === consumedEventParam) return;
		consumedEventParam = ev;
		const point = page.url.searchParams.get('point');
		const selectParam = siteParameters.find((s) => s.id === point)?.parameter_id ?? null;
		untrack(() => void openVisit(ev, true, selectParam));
	});
</script>

{#snippet calculationBadge(source: string | undefined, state: string | undefined)}
	{@const badge = visitBadge(source, state)}
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
				<div class="flex flex-wrap items-end gap-3">
					<div>
						<label for="visits-start" class="text-xs text-brand-muted block mb-1">From</label>
						<input
							id="visits-start"
							type="datetime-local"
							value={visitsStart ? toDatetimeLocal(visitsStart) : ''}
							onchange={(e) => { const v = e.currentTarget.value; visitsStart = v ? fromDatetimeLocal(v) : null; }}
							class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
						/>
					</div>
					<div>
						<label for="visits-end" class="text-xs text-brand-muted block mb-1">To</label>
						<input
							id="visits-end"
							type="datetime-local"
							value={visitsEnd ? toDatetimeLocal(visitsEnd) : ''}
							onchange={(e) => { const v = e.currentTarget.value; visitsEnd = v ? fromDatetimeLocal(v) : null; }}
							class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
						/>
					</div>
					{#if visitsStart || visitsEnd}
						<Button size="sm" onclick={() => { visitsStart = null; visitsEnd = null; }}>All dates</Button>
					{/if}
					{#if groups.length > 0}
						<div>
							<label for="visits-group" class="text-xs text-brand-muted block mb-1">Parameter group</label>
							<select
								id="visits-group"
								bind:value={groupFilter}
								class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
								title="Narrow the table to one group. Every parameter the site is assigned keeps its column either way."
							>
								<option value="">All groups</option>
								{#each groups as group (group.id)}
									<option value={group.id}>{group.label}</option>
								{/each}
								<option value="none">Ungrouped</option>
							</select>
						</div>
					{/if}
					{#if me.can('writeData')}
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
						<span
							class="text-brand-muted cursor-help text-xs"
							title="This grid as displayed: one row per visit, one column per parameter code, the served value in each cell. For the readings themselves in long format (one row per reading, replicates and flags included) use Export."
						>(i)</span>
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
					{#if me.can('writeData')}
						<div class="flex flex-wrap items-center gap-2">
							{#if entering}
								<Button
									size="sm"
									variant="secondary"
									disabled={screened}
									loading={checking}
									title="Screen what you have entered against this site's seasonal distribution. A save is held to exactly the values its check covered."
									onclick={runChecks}
								>{checking ? 'Checking…' : screened ? 'Checked' : 'Check against site history'}</Button>
							{/if}
							<Button
								size="sm"
								variant="primary"
								disabled={moved === 0 || !screened}
								title={moved > 0 && !screened ? 'Check these values against the site history first' : undefined}
								onclick={askToSave}
							>{`Save ${moved} value${moved === 1 ? '' : 's'}`}</Button>
							{#if moved > 0}
								<Button size="sm" variant="ghost" onclick={undoEdit} disabled={editHistory.length === 0}>Undo</Button>
								<Button
									size="sm"
									variant="ghost"
									onclick={() => { edits = {}; editHistory = empty(); checks = {}; seasonalFindings = []; }}
								>Discard what you typed</Button>
							{/if}
							{#if saveRefusal}
								<span class="text-xs text-severity-alarm">{saveRefusal}</span>
							{/if}
							{#if pasteRefusal}
								<span class="text-xs text-severity-warning-text">{pasteRefusal}</span>
							{/if}
							{#if runReport}
								<span class="text-xs text-brand-muted">{runReport}</span>
							{/if}
						</div>
						{#if seasonalFindings.length > 0}
							<div class="flex flex-col gap-0.5">
								{#each seasonalFindings as finding (finding.parameterId + finding.text)}
									<span class="text-xs text-severity-warning-text">{finding.text}</span>
								{/each}
							</div>
						{/if}
					{/if}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto"
						role="grid"
						tabindex="-1"
						onkeydown={onTableKey}
						onmouseup={() => (dragging = false)}
						onmouseleave={() => (dragging = false)}
					>
						<table class="w-full text-sm">
							<thead>
								<tr class="bg-brand-bg text-left text-xs text-brand-muted">
									<th rowspan="2" class="sticky left-0 z-10 bg-brand-bg px-4 py-2 font-medium">Date</th>
									<th rowspan="2" class="px-3 py-2 font-medium">Source</th>
									<th rowspan="2" class="px-3 py-2 font-medium">Filled</th>
									{#each groupColumns as col (col.parameterId)}
										<th colspan={col.width} class="px-3 py-2 font-medium whitespace-nowrap" title={col.name}>
											{#if expandable(visits, col.parameterId)}
												<button
													type="button"
													class="cursor-pointer border-none bg-transparent p-0 font-medium text-inherit hover:underline"
													aria-expanded={col.expanded}
													title={col.expanded ? `Fold ${col.code} back to its served value` : `Open ${col.code} to its repeats`}
													onclick={() => (expandedColumns = toggled(expandedColumns, col.parameterId))}
												>{col.code}{col.expanded ? ' −' : ' +'}</button>
											{:else}
												{col.code}
											{/if}{#if col.units}<span class="font-normal text-brand-muted"> ({col.units})</span>{/if}
											{#if col.expanded && me.can('writeData')}
												<button
													type="button"
													class="ml-1 rounded border border-brand-divider bg-transparent px-1 leading-none"
													aria-label="One repeat fewer for {col.code}"
													title="One repeat fewer. A repeat the store holds is not dropped here: that is a withdrawal."
													onclick={() => (askedColumns = askedWidth(askedColumns, visits, col.parameterId, col.width - 1))}
												>&minus;</button>
												<button
													type="button"
													class="rounded border border-brand-divider bg-transparent px-1 leading-none"
													aria-label="One repeat more for {col.code}"
													title="One repeat more"
													onclick={() => (askedColumns = askedWidth(askedColumns, visits, col.parameterId, col.width + 1))}
												>&plus;</button>
											{/if}
										</th>
									{/each}
								</tr>
								<tr class="bg-brand-bg text-left text-[10px] text-brand-muted">
									{#each groupColumns as col (col.parameterId)}
										{#if col.expanded}
											{#each Array.from({ length: col.width }, (_, i) => i) as index (index)}
												<th class="px-3 pb-1 font-normal">{index + 1}</th>
											{/each}
										{:else}
											<th class="px-3 pb-1 font-normal"></th>
										{/if}
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each visits as v, vIndex (v.id)}
									{@const cellsById = new Map(v.cells.map((c) => [c.parameter_id, c]))}
									{@const extraCells = v.cells.filter(
										(c) => !visitColumns.some((col) => col.parameter_id === c.parameter_id),
									)}
									<tr class="border-t border-brand-divider hover:bg-brand-bg/50 {expandedVisit === v.id ? 'bg-brand-bg/50' : ''}">
										<td class="sticky left-0 z-10 bg-brand-surface px-4 py-2 whitespace-nowrap">
											<button
												type="button"
												class="cursor-pointer border-none bg-transparent p-0 text-left text-inherit hover:underline"
												aria-expanded={expandedVisit === v.id}
												title={expandedVisit === v.id ? 'Collapse this visit' : 'Expand this visit'}
												onclick={() => openVisit(v.id)}
											>{formatDateTime(v.collected_at)}</button>
											{#if v.findings_open > 0}
												<Badge variant="warning">{v.findings_open} finding{v.findings_open === 1 ? '' : 's'}</Badge>
											{/if}
											{@render calculationBadge(v.source, v.recompute)}
											{@render visitState(v.unverified, v.withdrawn_at)}
										</td>
										<td class="px-3 py-2">
											{#if v.source === 'portal_sync'}
												<Badge variant="accent">portal</Badge>
											{:else}
												<span class="text-brand-muted">{v.created_by ?? 'manual'}</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-brand-muted whitespace-nowrap">{v.parameters_filled}/{visitColumns.length}</td>
										{#each groupColumns as col (col.parameterId)}
											{@const cell = cellsById.get(col.parameterId)}
											{#if col.expanded}
												{#each Array.from({ length: col.width }, (_, i) => i) as index (index)}
													{@const replicate = cell?.replicates?.[index]}
													{@const entry = slotWritable(v, col.parameterId, index)}
													<td
														class="px-3 py-2 tabular-nums whitespace-nowrap
															{replicate?.withdrawn ? 'text-brand-muted line-through' : ''}
															{replicate?.flagged ? 'text-severity-warning' : ''}
															{replicate?.unverified ? 'text-severity-warning' : ''}"
													>
														{#if me.can('writeData') && entry.writable}
															{@const key = slotKey({ eventId: v.id, parameterId: col.parameterId, replicateIndex: index })}
															{@const at = cellPosition(vIndex, col.parameterId, index)}
															<input
																id="visit-cell-{at.row}-{at.column}"
																class="w-20 rounded border px-1 py-0.5 text-right tabular-nums bg-brand-surface
																	{key in edits ? 'border-brand-primary' : 'border-brand-divider'}
																	{selected(at.row, at.column) ? 'ring-1 ring-brand-primary' : ''}"
																aria-label="{col.code} repeat {index + 1} at {formatDateTime(v.collected_at)}"
																value={cellDisplay(key, replicate?.value ?? null, col.decimals)}
																onfocus={() => { focusedSlot = key; focused = onFocusMoved(focused, at.row, at.column); }}
																onblur={() => { if (focusedSlot === key) focusedSlot = null; }}
																onkeydown={(e) => onCellKey(e, at.row, at.column)}
																onmousedown={() => startDrag(at.row, at.column)}
																onmouseenter={() => extendDrag(at.row, at.column)}
																onpaste={(e) => onCellPaste(e, at.row, at.column)}
																oninput={(e) => typeCell(v, col.parameterId, index, e.currentTarget.value)}
															/>
														{:else if replicate}
															<button
																type="button"
																class="cursor-pointer border-none bg-transparent p-0 text-inherit hover:underline"
																title={[
																	`Repeat ${replicate.replicate_index + 1} of ${col.name} at this visit`,
																	entry.reason,
																].filter(Boolean).join('\n')}
																onclick={(e) => void openVisitCell(v.id, col.parameterId, e.currentTarget)}
															>{formatMeasurement(replicate.value, col.decimals)}</button>
														{:else}
															<span class="text-brand-muted">-</span>
														{/if}
													</td>
												{/each}
											{:else}
												{@const entry = slotWritable(v, col.parameterId, 0)}
												<td
													class="px-3 py-2 tabular-nums whitespace-nowrap
														{cell?.finding === 'stale_output' || cell?.finding === 'skipped_output' ? 'bg-severity-warning-soft' : ''}
														{cell?.withdrawn ? 'text-brand-muted line-through' : ''}
														{cell?.flagged ? 'text-severity-warning' : ''}"
												>
													{#if me.can('writeData') && editable(col) && entry.writable}
														{@const key = slotKey({ eventId: v.id, parameterId: col.parameterId, replicateIndex: 0 })}
														{@const at = cellPosition(vIndex, col.parameterId, 0)}
														<input
															id="visit-cell-{at.row}-{at.column}"
															class="w-20 rounded border px-1 py-0.5 text-right tabular-nums bg-brand-surface
																{key in edits ? 'border-brand-primary' : 'border-brand-divider'}
																{selected(at.row, at.column) ? 'ring-1 ring-brand-primary' : ''}"
															aria-label="{col.code} at {formatDateTime(v.collected_at)}"
															value={cellDisplay(key, cell?.replicates?.[0]?.value ?? null, col.decimals)}
															onfocus={() => { focusedSlot = key; focused = onFocusMoved(focused, at.row, at.column); }}
															onblur={() => { if (focusedSlot === key) focusedSlot = null; }}
															onkeydown={(e) => onCellKey(e, at.row, at.column)}
															onmousedown={() => startDrag(at.row, at.column)}
															onmouseenter={() => extendDrag(at.row, at.column)}
															onpaste={(e) => onCellPaste(e, at.row, at.column)}
															oninput={(e) => typeCell(v, col.parameterId, 0, e.currentTarget.value)}
														/>
													{:else if !cell}
														<span class="text-brand-muted">-</span>
													{:else}
														<button
															type="button"
															class="cursor-pointer border-none bg-transparent p-0 text-inherit hover:underline"
															aria-pressed={expandedVisit === v.id && visitCell?.parameterId === col.parameterId}
															title={[visitCellStatistics(cell, col.decimals, col.units), `Open the record of ${col.name} at this visit`].filter(Boolean).join('\n')}
															onclick={(e) => void openVisitCell(v.id, col.parameterId, e.currentTarget)}
														>
															{#if cell.finding === 'missing_output' && cell.value == null}
																<Badge variant="warning">missing</Badge>
															{:else if cell.value != null}
																{@const marker = visitCellMarker(cell)}
																{formatMeasurement(cell.value, col.decimals)}
																{#if (cell.n ?? 0) > 1}
																	<span class="text-[10px] text-brand-muted align-super">n{cell.n}</span>
																{/if}
																{#if marker}
																	<span class="text-severity-warning" title={marker.title}>{marker.text}</span>
																{/if}
															{:else}
																<span class="text-brand-muted">-</span>
															{/if}
														</button>
													{/if}
												</td>
											{/if}
										{/each}
										{#each extraCells as cell (cell.parameter_id)}
											<td class="px-3 py-2 tabular-nums whitespace-nowrap text-brand-muted">
												{#if cell.value != null}
													<button
														type="button"
														class="cursor-pointer border-none bg-transparent p-0 text-inherit hover:underline"
														aria-pressed={expandedVisit === v.id && visitCell?.parameterId === cell.parameter_id}
														title="Open the record of {paramName(cell.parameter_id)} at this visit"
														onclick={(e) => void openVisitCell(v.id, cell.parameter_id, e.currentTarget)}
													>{formatMeasurement(cell.value, decimalsForParameter(cell.parameter_id))}</button>
												{:else}
													-
												{/if}
											</td>
										{/each}
									</tr>
									{#if expandedVisit === v.id}
										<tr class="border-t border-brand-divider">
											<td colspan={3 + columnSpan(groupColumns)} class="bg-brand-bg/50 px-4 py-3">
												<!-- The row spans a table wider than the window, so the panel is pinned to the
												     window's left edge and takes only the width its content needs: reading what
												     a visit holds is never a sideways scroll (S15). -->
												<div class="sticky left-0 w-max max-w-[calc(100vw-3rem)]">
												{#if visitDetailLoading}
													<p class="text-xs text-brand-muted">Loading…</p>
												{:else if visitDetail}
													{@const counts = visitCounts(visitDetail.cells)}
													<div class="mb-2 flex items-center justify-between gap-2">
														<div class="text-xs text-brand-muted">
															<span class="font-mono text-brand-text">
																{counts.parameters} parameter{counts.parameters === 1 ? '' : 's'} · {counts.replicates} replicate{counts.replicates === 1 ? '' : 's'} · {counts.flagged} flagged · {counts.withdrawn} withdrawn · {counts.findings} finding{counts.findings === 1 ? '' : 's'}
															</span>
															·
															{visitSourceLabel(visitDetail.source, visitDetail.created_by)}{#if entryNoticeFor(visitDetail.source)}. {SYNCED_VISIT_NOTICE}{/if}
															{#if verificationNoticeFor(visitDetail.unverified, visitDetail.withdrawn_at)}. {verificationNoticeFor(visitDetail.unverified, visitDetail.withdrawn_at)}{/if}
															{#if visitDetail.notes}· {visitDetail.notes}{/if}
															{@render calculationBadge(visitDetail.source, visitDetail.recompute)}
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
																<!-- Calculations do not run at a visit the sync created (Q41): the portal
																     recomputes its own outputs, and the route refuses this. -->
																{#if visitDetail.source !== 'portal_sync'}
																	<Button
																		size="sm"
																		variant="secondary"
																		disabled={visitBusy === v.id}
																		onclick={(e) => { e.stopPropagation(); runVisitJob(v.id, 'recompute'); }}
																	>{visitBusy === v.id ? 'Working…' : 'Recompute tools'}</Button>
																{/if}
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
													<table class="w-full text-xs">
														<thead class="text-brand-muted">
															<tr>
																<th class="py-1 pr-3 text-left font-medium">Parameter</th>
																<th class="py-1 pr-3 text-left font-medium">Served</th>
																<th class="py-1 pr-3 text-left font-medium">Replicates</th>
																<th class="py-1 pr-3 text-left font-medium">Provenance</th>
																<th class="py-1 text-left font-medium">Finding</th>
															</tr>
														</thead>
														<tbody>
															{#each visitDetail.cells as cell (cell.parameter_id + cell.stream_id)}
																<tr
																	class="border-t border-brand-divider/60 cursor-pointer hover:bg-brand-bg/60 {visitCell?.parameterId === cell.parameter_id ? 'bg-brand-bg' : ''}"
																	aria-selected={visitCell?.parameterId === cell.parameter_id}
																	onclick={() => (visitCell = { parameterId: cell.parameter_id, parameterName: cell.parameter_name })}
																>
																	<td class="py-1 pr-3">
																		<button
																			type="button"
																			class="cursor-pointer border-none bg-transparent p-0 text-left text-inherit hover:underline"
																			aria-pressed={visitCell?.parameterId === cell.parameter_id}
																			onclick={() => (visitCell = { parameterId: cell.parameter_id, parameterName: cell.parameter_name })}
																		>{cell.parameter_name}</button>
																		{#if unitsForParameter(cell.parameter_id)}<span class="text-brand-muted">({unitsForParameter(cell.parameter_id)})</span>{/if}
																		{#if me.can('writeData') && !cell.written_by && instruments.length > 0}
																			{@const declared = declaredInstruments[instrumentKey(v.id, cell.parameter_id)] ?? ''}
																			<select
																				class="ml-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] hover:border-brand-divider"
																				title="What measured this parameter at this visit. It is stored on every value entered here."
																				aria-label="Instrument for {cell.parameter_name} at this visit"
																				value={declared}
																				onclick={(e) => e.stopPropagation()}
																				onchange={(e) => declareInstrument(v.id, cell.parameter_id, e.currentTarget.value)}
																			>
																				<option value="">Undeclared</option>
																				{#each pickerOptions(instruments, declared || undefined) as sensor (sensor.id)}
																					<option value={sensor.id}
																						>{sensor.name ?? sensor.serial_number ?? sensor.id.slice(0, 8)}{retiredSuffix(sensor)}</option
																					>
																				{/each}
																			</select>
																		{/if}
																		{#if cellRole(cell).title}
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
																			>±{formatMeasurement(cell.sample.stdev, decimalsForParameter(cell.parameter_id))} ({estimatorWord(cell.sample.sd_estimator)}, n={cell.sample.n})</span>
																		{/if}
																	</td>
																	<td class="py-1 pr-3 tabular-nums text-brand-muted">
																		{cell.replicates
																			.map((r) => `${formatMeasurement(r.calibrated_value ?? r.raw_value, decimalsForParameter(cell.parameter_id))}${r.flagged ? '*' : ''}${r.withdrawn ? '†' : ''}`)
																			.join(', ')}
																	</td>
																	<td class="py-1 pr-3">
																		{#if cell.has_provenance}
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
																</tr>
															{/each}
														</tbody>
													</table>
													{#if visitDetail.cells.some((c) => c.replicates.some((r) => r.flagged || r.withdrawn))}
														<p class="mt-1 text-[11px] text-brand-muted">* flagged · † withdrawn at source · ? pending verification</p>
													{/if}
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
												{/if}
												</div>
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
					{#if visits.some((v) => v.cells.some((c) => visitCellMarker(c)))}
						<p class="text-[11px] text-brand-muted">* flagged · † withdrawn at source · ? pending verification</p>
					{/if}
				{/if}
			</div>

<Dialog bind:open={confirmOpen} title="Save what you typed" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-2 text-sm">
			<p>
				{moved} value{moved === 1 ? '' : 's'} will be written across {writes.length} visit{writes.length === 1 ? '' : 's'},
				{writes.reduce((n, w) => n + w.corrections.length, 0)} corrected in place.
			</p>
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
