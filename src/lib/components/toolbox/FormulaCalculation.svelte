<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		api,
		type AlarmThreshold,
		type Constant,
		type DerivedParameter,
		type Parameter,
		type ParameterGroupMember,
		type Site,
		type SiteParameter,
		type ToolRunRow,
	} from '$api/crud';
	import {
		draftRunFormulas,
		getStepDependents,
		getToolRunTrace,
		getToolScript,
		listVisitSites,
		listVisitsHolding,
		listToolScripts,
		listToolVersionUsage,
		listVersionLedger,
		saveFormulaSet,
		formulaTakeovers,
		type FormulaDraftRunResponse,
		type ToolRunTrace,
		type GivenUpOutput,
		type Takeover,
		type StepDependents,
		type ToolScriptDetail,
		type ToolVersionUsage,
		type VersionLedgerRow,
		type VisitListRow,
	} from '$api/service';
	import { listAll } from '$api/paged';
	import {
		blankFormula,
		dependencyOrder,
		draftOutputs,
		curveSlots,
		draftRunBody,
		editableFormula,
		receivedSteps,
		stepOffers,
		formulaSetBody,
		formulaVariables,
		inputRows,
		untilLeft,
		type FocusedFormula,
		scalarOverrides,
		seriesBlocker,
		setOutputs,
		thresholdWrites,
		type EditableFormula,
		type StepOffer,
	} from '$lib/calculations/editor';
	import { apiMessage } from '$lib/standardCurves';
	import { storedLabel, versionConsequence } from '$lib/calculations/consequence';
	import { takeoverLine } from '$lib/calculations/takeover';
	import { ledgerLines, type LedgerOutput } from '$lib/calculations/versionLedger';
	import { historyPanes, openPane, type HistoryKey } from '$lib/calculations/historyPanes';
	import {
		isReplicateStatistic,
		portalReference,
		referenceOrigin,
		referenceText,
		replicatedCodes,
	} from '$lib/calculations/members';
	import { fullReach, offeredSites, rankByReach, type VisitCount } from '$lib/calculations/siteReach';
	import { visitToOpen } from '$lib/visits/opening';
	import { fromNum } from '$lib/derivedParameters';
	import { curveField } from '$lib/tools/form';
	import { runInputTables, runTables, type PreviewInstant } from '$lib/tools/runTable';
	import LivePreview from '$components/derived/LivePreview.svelte';
	import {
		insertIdentifier,
		rowKey,
		sheetBlocks,
		withReplicate,
		type DeclaredInput,
		type RowRemoval,
		type SheetEdit,
		type SheetRow,
		type SheetSelection,
	} from '$lib/calculations/sheet';
	import type { DragPayload } from '$components/formula/ast';
	import { formatDate, formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import FormulaPalette from '$components/formula/FormulaPalette.svelte';
	import CalculationSites from '$components/toolbox/CalculationSites.svelte';
	import CalculationSettings from '$components/toolbox/CalculationSettings.svelte';
	import DecommissionBanner from '$components/toolbox/DecommissionBanner.svelte';
	import CalculationSheet from '$components/toolbox/CalculationSheet.svelte';
	import CellPanel from '$components/toolbox/CellPanel.svelte';
	import CurvePicker, { emptyCurveSelection, type CurveSelection } from '$components/tools/CurvePicker.svelte';
	import type { Diagnostic } from '$lib/formula/lint';
	import { AUTHORING_REFUSED } from '$lib/toolbox/authoring';
	import { ApiError } from '$api/client';

	// A calculation whole: what it reads on the left, its formulas in order in the middle, what
	// it publishes on the right, and below them a run of the set as it stands at a real visit.
	// Nothing on the page is specific to one calculation.

	let { calculationId }: { calculationId: string } = $props();

	let calculation = $state<ToolScriptDetail | null>(null);
	// What each version has already produced, so the save says what it moves before it is made.
	let usage = $state<ToolVersionUsage[]>([]);
	let stored = $state<EditableFormula[]>([]);
	let formulas = $state<EditableFormula[]>([]);
	let parameters = $state<Parameter[]>([]);
	let constants = $state<Constant[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);
	/** What the last save stopped publishing, so the page says what it left behind. */
	let givenUp: GivenUpOutput[] = $state([]);
	// Columns the last save would take over, waiting on the author's confirm (Q299).
	let takingOver = $state<Takeover[]>([]);

	let diagnostics = $state<Diagnostic[]>([]);
	// The cell the reader is on, and the formula the panel edits: the selected row's, or one just
	// added, which the tables cannot show until it has a code.
	let selected = $state<SheetSelection | null>(null);
	let picked = $state<EditableFormula | null>(null);
	let focused = $state<FocusedFormula<EditableFormula> | null>(null);
	let cellPanel = $state<CellPanel | null>(null);
	// Inputs brought in from the palette before a formula names one. They are rows of the table and
	// nothing else: the save does not keep them.
	let declared = $state<DeclaredInput[]>([]);
	// Every input and formula change bumps the generation; a run remembers the one it read, so the
	// numbers on screen say whether they are still the ones being shown. The counter itself is a
	// plain variable: the effect that bumps it must not depend on what it writes.
	let generation = 0;
	let scheduled = $state(0);
	let ranAt = $state(0);
	let requests = 0;
	let rerunTimer: ReturnType<typeof setTimeout> | null = null;

	// The historical result the page was opened on, when a link named one: the cell to select, the
	// run to draw, and the replicate the reader came from. The recorded run stands until the
	// person edits the set or the visit, which is what reruns it.
	const anchorCell = page.url.searchParams.get('cell') ?? '';
	const anchorRun = page.url.searchParams.get('run') ?? '';
	const anchorIndex = Number.parseInt(page.url.searchParams.get('index') ?? '', 10);
	let recorded = $state<ToolRunTrace | null>(null);
	/** The runs of this calculation at the chosen visit, newest first. */
	let runsAtVisit = $state<ToolRunRow[]>([]);
	// What each pinned version has already computed on the stream arm. Unlike a run, a continuous
	// evaluation records no identity of its own, so the ledger is per version, not per evaluation.
	let ledger = $state<VersionLedgerRow[]>([]);
	/** The output parameters this calculation publishes, as the ledger links them. */
	let publishedOutputs = $state<LedgerOutput[]>([]);

	let siteId = $state(page.url.searchParams.get('site') ?? '');
	let visits = $state<VisitListRow[]>([]);
	let visitId = $state(page.url.searchParams.get('visit') ?? '');
	let visitsLoading = $state(false);
	let replicateText = $state<Record<string, string>>({});
	// A number typed in place of what the visit or the catalog holds, so a set can be checked
	// against its golden figures before any visit carries them. Blank reads the stored value.
	let scalarText = $state<Record<string, string>>({});
	// One selection per declared curve slot: what binds `curve_slope` and `curve_intercept` for
	// the run. Unbound, the slot's formulas are skipped for want of coefficients.
	let curveChoice = $state<Record<string, CurveSelection>>({});
	let running = $state(false);
	// The instant the reader is on in the series preview. While one is chosen the tables show the
	// set's numbers there, in place of the visit's.
	let hovered = $state<PreviewInstant | null>(null);
	let run = $state<FormulaDraftRunResponse | null>(null);
	let runError = $state('');

	// The group memberships of the catalog: what a parameter is entered several times as, and what
	// the source computed it with. A calculation names no group (Q169), so both are read per
	// parameter, for the parameters this set reads and writes.
	let members = $state<ParameterGroupMember[]>([]);
	// Which sites hold which parameters, so the series preview offers only the sites that can run
	// the set. A slot the site does not declare is a series the preview cannot draw.
	let allSites = $state<Site[]>([]);
	let allSiteParams = $state<SiteParameter[]>([]);

	// Steps this calculation reads but does not own (Q156), and the ones it could bring in.
	let shareable = $state<StepOffer[]>([]);
	let declaring = $state('');
	const offered = $derived(shareable.find((o) => o.id === declaring) ?? null);
	let dependents = $state<Record<string, StepDependents>>({});

	const usageByVersion = $derived(new Map(usage.map((u) => [u.version_id, u])));
	const activeUsage = $derived(usage.find((u) => u.version_no === calculation?.active_version_no));
	// Nothing to leave behind or recompute until a version has been serving: the first save
	// supersedes none.
	const supersedes = $derived(calculation?.active_version_no != null);
	const ordered = $derived(dependencyOrder(formulas));
	// A source of a replicated parameter that a per-replicate formula walks is the family, not its
	// mean (Q155); replicate-ness is the parameter's, in whichever group holds it.
	const replicated = $derived(replicatedCodes(members, parameters));
	// A name the formula under the cursor reads becomes an input once its field is left (Q304).
	const inputs = $derived(inputRows(untilLeft(formulas, focused), parameters, constants, replicated));
	const slots = $derived(curveSlots(formulas));
	// Why the set cannot be read as a series, or null when it can. A set with no blocker draws over
	// a site's streams; one with a blocker runs at field visits and the page says which input.
	const blocker = $derived(seriesBlocker(formulas));
	const sitesWithAvailability = $derived(
		allSites.map((s) => ({
			id: s.id,
			name: s.name,
			availableParamNames: allSiteParams
				.filter((sp) => sp.site_id === s.id && sp.is_active)
				.map((sp) => parameters.find((p) => p.id === sp.parameter_id)?.code)
				.filter((code): code is string => !!code),
		})),
	);
	/** What the set reads from a site: a step is computed by the run, not measured there. */
	const readsAtSite = $derived(
		inputs.filter((i) => i.kind === 'parameter' || i.kind === 'replicates').map((i) => i.name),
	);
	/** What a site or visit must hold for the set to run: an optional input has its fallback. */
	const requiredAtSite = $derived(
		inputs
			.filter((i) => !i.optional && (i.kind === 'parameter' || i.kind === 'replicates'))
			.map((i) => i.name),
	);
	const readIds = $derived(
		requiredAtSite
			.map((code) => parameters.find((p) => p.code === code)?.id)
			.filter((id): id is string => !!id),
	);
	// Each site's count of the visits holding every required input, fetched once per input set.
	let visitCounts = $state<VisitCount[] | null>(null);
	const readKey = $derived(readIds.join(','));
	$effect(() => {
		const ids = readKey ? readKey.split(',') : [];
		visitCounts = null;
		if (ids.length === 0) return;
		let current = true;
		listVisitSites(ids)
			.then((counts) => {
				if (current) visitCounts = counts;
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	});
	// The sites to offer: those with a visit the set runs at, and for a set that also draws over
	// streams, the other sites measuring everything it requires.
	const siteChoices = $derived(
		offeredSites(
			sitesWithAvailability,
			fullReach(rankByReach(sitesWithAvailability, requiredAtSite)),
			visitCounts,
			!blocker,
		),
	);
	const noteById = $derived(new Map(siteChoices.map((c) => [c.id, c.note])));
	const previewSet = $derived(formulaSetBody(formulas).formulas);
	// A formula added, edited, or dropped from the set: all three are the save's business.
	const dropped = $derived(
		stored.filter((s) => !s.declarationId && !s.receivedThrough && !formulas.some((f) => f.id === s.id)),
	);
	const ownCount = $derived(formulas.filter((f) => !f.declarationId && !f.receivedThrough).length);
	const unsaved = $derived(
		formulas.some((f) => f.id === null || isDirty(f)) || dropped.length > 0,
	);
	const visit = $derived(visits.find((v) => v.id === visitId) ?? null);
	const paramVars = $derived(formulaVariables(parameters, replicated));
	// A recorded run draws through the same tables a fresh one does: the trace route carries the
	// values it produced and the manifest of the version it pinned, so nothing here re-resolves.
	const shown = $derived(
		recorded
			? {
					ran: true,
					results: recorded.results,
					skipped: recorded.skipped,
					trace: recorded.trace,
					manifest: recorded.manifest,
					event_inputs: recorded.event_inputs,
					site_inputs: recorded.site_inputs,
					constants: recorded.constants,
					curves: recorded.curves,
				}
			: run,
	);
	const tables = $derived(
		hovered
			? runTables(hovered.results, setOutputs(formulas))
			: shown?.ran
				? runTables(
						shown.results ?? {},
						draftOutputs(shown.manifest),
						(shown.skipped ?? []) as Parameters<typeof runTables>[2],
						shown.trace ?? [],
					)
				: null,
	);
	// What the run was given, in the same table shape: the visit's own values, then the numbers
	// that are the same at every visit.
	const given = $derived(
		hovered
			? runInputTables(hovered.inputs)
			: shown?.ran
			? runInputTables(
					(shown.event_inputs ?? []) as Parameters<typeof runInputTables>[0],
					(shown.site_inputs ?? []) as Parameters<typeof runInputTables>[1],
					shown.constants ?? {},
					(shown.curves ?? []) as Parameters<typeof runInputTables>[3],
				)
			: undefined,
	);

	// The tables the page is: the set's inputs, its steps when it has any or the author turned
	// them on, and its outputs, filled by the run.
	let showSteps = $state(false);
	const blocks = $derived(
		sheetBlocks(formulas, inputs, declared, given, tables ?? undefined, showSteps, {
			scalars: scalarText,
			replicates: replicateText,
		}),
	);
	const stale = $derived(recorded === null && run !== null && ranAt < scheduled);
	// Said on the disabled save rather than in the bar, whose height the sheet sits under.
	const saveBlocked = $derived(diagnostics.length > 0 ? 'Put right what the formula says wrong first' : undefined);

	const selectedRow = $derived(
		selected
			? ((blocks.find((b) => b.key === selected!.block)?.rows ?? []).find(
					(r) => r.key === selected!.key,
				) ?? null)
			: null,
	);

	// The codes this set names: what its formulas read, and what they publish.
	const namedCodes = $derived([
		...new Set([
			...inputs.filter((i) => i.kind === 'parameter' || i.kind === 'replicates').map((i) => i.name),
			...formulas.map((f) => f.code.trim()).filter(Boolean),
		]),
	]);
	// How the portal produced each of those, as its pairing plan recorded it (Q149): what this
	// calculation is checked against, not something this page edits.
	const reference = $derived(portalReference(members, parameters, namedCodes));

	function isDirty(f: EditableFormula): boolean {
		const was = stored.find((s) => s.id === f.id);
		return !was || JSON.stringify(was) !== JSON.stringify(f);
	}

	/** The steps this calculation reads through a declaration, as read-only rows of the list. */
	async function declaredSteps(steps: DerivedParameter[]): Promise<EditableFormula[]> {
		const declarations = await api.calculationSharedSteps.list({
			perPage: 200,
			filter: { tool_script_id: calculationId },
		});
		const rows: EditableFormula[] = [];
		for (const declaration of declarations.data) {
			const step = steps.find((s) => s.id === declaration.formula_id);
			if (step) rows.push({ ...editableFormula(step), declarationId: declaration.id, shared: true });
		}
		return rows;
	}

	/** Each output's own bounds, read from the `alarm_thresholds` row of its parameter with no site. */
	async function withBounds(
		editable: EditableFormula[],
		rows: DerivedParameter[],
	): Promise<EditableFormula[]> {
		const parameterIds = rows.map((r) => r.output_parameter_id).filter((id): id is string => !!id);
		if (parameterIds.length === 0) return editable;
		const global = new Map<string, AlarmThreshold>();
		const held = await listAll<AlarmThreshold>(api.alarmThresholds, { perPage: 500 });
		for (const t of held) {
			const id = t.parameter_id;
			if (id && t.site_id === null && parameterIds.includes(id)) global.set(id, t);
		}
		return editable.map((f, i) => {
			const bound = rows[i]?.output_parameter_id ? global.get(rows[i]!.output_parameter_id!) : null;
			return bound
				? {
						...f,
						thresholds: {
							warningMin: fromNum(bound.warning_min),
							warningMax: fromNum(bound.warning_max),
							alarmMin: fromNum(bound.alarm_min),
							alarmMax: fromNum(bound.alarm_max),
						},
					}
				: f;
		});
	}

	async function declare() {
		if (!offered) return;
		const brought = [...offered.chain.map((s) => s.code), offered.code];
		busy = true;
		try {
			await api.calculationSharedSteps.create({
				tool_script_id: calculationId,
				formula_id: declaring,
			});
			declaring = '';
			await load();
			toastStore.success(`Brought in ${brought.join(', ')}`);
		} catch (e) {
			toastStore.error(`Could not bring in ${offered.code}: ${apiMessage(e)}`);
		} finally {
			busy = false;
		}
	}

	async function stopReading(f: EditableFormula) {
		if (!f.declarationId) return;
		busy = true;
		try {
			await api.calculationSharedSteps.remove(f.declarationId);
			await load();
			toastStore.success('Step no longer read here');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not drop the step');
		} finally {
			busy = false;
		}
	}

	async function showDependents(f: EditableFormula) {
		if (!f.id || dependents[f.id]) return;
		try {
			dependents = { ...dependents, [f.id]: await getStepDependents(f.id) };
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not read what the step feeds');
		}
	}

	/** Reread the calculation's own fields without discarding the formulas being edited. */
	async function refreshCalculation() {
		try {
			calculation = await getToolScript(calculationId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not reread the calculation');
		}
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const [script, rows, params, consts, steps, memberRows, scripts] = await Promise.all([
				getToolScript(calculationId),
				api.derivedParameters.list({
					perPage: 500,
					filter: { tool_script_id: calculationId },
					sort: ['ordinal', 'ASC'],
				}),
				listAll<Parameter>(api.parameters, { perPage: 500, sort: ['code', 'ASC'] }),
				listAll<Constant>(api.constants, { perPage: 500, sort: ['name', 'ASC'] }),
				listAll<DerivedParameter>(api.derivedParameters, {
					perPage: 500,
					filter: { intermediate: true },
					sort: ['code', 'ASC'],
				}),
				listAll<ParameterGroupMember>(api.parameterGroupMembers, { perPage: 500 }),
				listToolScripts().catch(() => []),
			]);
			listAll<Site>(api.sites, { perPage: 200, sort: ['name', 'ASC'] })
				.then((rows) => (allSites = rows))
				.catch(() => (allSites = []));
			listAll<SiteParameter>(api.siteParameters, { perPage: 1000 })
				.then((rows) => (allSiteParams = rows))
				.catch(() => (allSiteParams = []));
			calculation = script;
			// The counts are what the save's arms are stated in. A page that cannot read them still
			// saves, and the arms say what they do without the numbers.
			listToolVersionUsage(calculationId)
				.then((rows) => (usage = rows))
				.catch(() => (usage = []));
			listVersionLedger(calculationId)
				.then((rows) => (ledger = rows))
				.catch(() => (ledger = []));
			publishedOutputs = rows.data
				.filter((f) => f.output_parameter_id)
				.map((f) => ({ parameterId: f.output_parameter_id!, code: f.code }));
			const declared = await declaredSteps(steps);
			const received = receivedSteps(declared, steps);
			const bounded = await withBounds(rows.data.map(editableFormula), rows.data);
			stored = [...bounded, ...declared, ...received];
			formulas = stored.map((f) => ({ ...f, thresholds: { ...f.thresholds } }));
			parameters = params;
			constants = consts;
			members = memberRows;
			// A step this calculation already reads, or already owns, is not one to bring in.
			const own = new Set(stored.map((f) => f.id));
			shareable = stepOffers(
				steps.filter((s) => !own.has(s.id)),
				steps,
				new Map(scripts.map((c) => [c.id, c.name])),
			);
		} catch (e) {
			error =
				e instanceof ApiError && (e.status === 401 || e.status === 403)
					? AUTHORING_REFUSED
					: e instanceof Error
						? e.message
						: 'Failed to load the calculation';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await load();
		if (siteId) await loadVisits(siteId, page.url.searchParams.get('visit') ?? '');
		if (anchorCell) choose(anchorCell);
		if (anchorRun) await openRecorded(anchorRun);
	});

	/** Append a row to the steps or to the outputs, and open its formula for typing. */
	function addRow(block: 'steps' | 'outputs') {
		const blank = blankFormula(formulas);
		blank.intermediate = block === 'steps';
		if (block === 'steps') showSteps = true;
		formulas = [...formulas, blank];
		const added = formulas[formulas.length - 1]!;
		picked = added;
		selected = { block, key: rowKey(added), column: 0 };
		void cellPanel?.editFormula();
	}

	/** A cell was typed, pasted or filled into: a dummy value, or the code of a new row. */
	function applyEdit(edit: SheetEdit) {
		if (!edit) return;
		if (edit.kind === 'replicate') {
			const list = withReplicate(replicateText[edit.name] ?? '', edit.index, edit.text);
			replicateText = { ...replicateText, [edit.name]: list };
		} else if (edit.kind === 'scalar') {
			scalarText = { ...scalarText, [edit.name]: edit.text };
		} else {
			const target = formulas.find((f) => rowKey(f) === edit.key);
			if (target) target.code = edit.text.trim();
		}
	}

	/** What a palette entry writes when it is dropped: an identifier, or a name for the run to
	 *  supply a value for. */
	function payloadName(payload: DragPayload): string {
		if (payload.kind === 'operator') return payload.op;
		if (payload.kind === 'function') return `${payload.name}()`;
		return payload.name;
	}

	function dropPayload(
		block: 'inputs' | 'steps' | 'outputs',
		row: SheetRow | null,
		payload: DragPayload,
	) {
		if (block === 'inputs') {
			if (payload.kind === 'operator' || payload.kind === 'function') return;
			const name = payload.name;
			if (inputs.some((i) => i.name === name) || declared.some((d) => d.name === name)) return;
			const constant = constants.find((c) => c.name === name);
			const parameter = parameters.find((p) => p.code === name);
			declared = [
				...declared,
				constant
					? { name, kind: 'constant', detail: constant.units ? `${constant.value} ${constant.units}` : String(constant.value) }
					: parameter
						? { name, kind: 'parameter', detail: parameter.default_units ? `${parameter.name} (${parameter.default_units})` : parameter.name }
						: { name, kind: 'other', detail: 'resolved by the server as a site property' },
			];
			return;
		}
		const target = formulas.find((f) => rowKey(f) === row?.key);
		if (target) target.formula = insertIdentifier(target.formula, payloadName(payload)).formula;
	}

	/** Open a row in the panel, from a cell of the tables or from a link in the panel itself. */
	function choose(next: SheetSelection | string | null) {
		selected =
			typeof next === 'string'
				? { block: 'outputs', key: next, column: 0 }
				: next;
		picked = selected
			? (formulas.find((f) => f.code.trim() === selected!.key) ?? null)
			: null;
	}

	/** A palette pick goes to the formula open in the panel, or at the end of the picked one. */
	function insert(payload: DragPayload) {
		if (cellPanel?.pick(payload)) return;
		if (!picked) return;
		picked.formula = insertIdentifier(picked.formula, payloadName(payload)).formula;
	}

	/**
	 * The bounds the author typed, onto the output parameters the saved set gives them. A create
	 * only learns its parameter from the after-create hook, so this runs on the set the save wrote.
	 */
	async function writeBounds(edited: EditableFormula[], before: EditableFormula[]) {
		const saved = await api.derivedParameters.list({
			perPage: 500,
			filter: { tool_script_id: calculationId },
		});
		const writes = thresholdWrites(edited, before, saved.data);
		if (writes.length === 0) return;
		const held = await listAll<AlarmThreshold>(api.alarmThresholds, { perPage: 500 });
		for (const write of writes) {
			const existing = held.find(
				(t) => t.site_id === null && t.parameter_id === write.parameterId,
			);
			if (existing) await api.alarmThresholds.update(existing.id, write.patch);
			else await api.alarmThresholds.create({ parameter_id: write.parameterId, ...write.patch });
		}
	}

	/**
	 * Write the whole formula set as one version, with the shared steps the author marked or
	 * corrected. The values the version being replaced produced are recomputed under the new one.
	 */
	async function saveSet(takeOver: string[] = []) {
		if (diagnostics.length > 0 || !unsaved) return;
		busy = true;
		takingOver = [];
		try {
			const edited = formulas;
			const before = stored;
			const res = await saveFormulaSet(calculationId, {
				...formulaSetBody(formulas, stored),
				take_over: takeOver,
			});
			givenUp = res.given_up ?? [];
			await writeBounds(edited, before);
			await load();
			toastStore.success(
				res.version_no === null
					? 'Saved; the formulas read as they did, so no version was minted'
					: res.migrated
						? `Version ${res.version_no} saved; the values it replaces are being recomputed`
						: `Version ${res.version_no} saved`,
			);
		} catch (e) {
			const offered = formulaTakeovers(e);
			if (offered) takingOver = offered;
			else toastStore.error(e instanceof Error ? e.message : 'Save failed');
		} finally {
			busy = false;
		}
	}

	/** Drop a formula from the pending set. The save deletes it, by leaving it out. */
	function remove(f: EditableFormula) {
		formulas = formulas.filter((x) => x !== f);
		if (picked === f) picked = null;
		selected = null;
	}

	/** What a row's remove control asked for, carried out on the pending set. */
	function removeRow(removal: RowRemoval) {
		if (removal.kind === 'input') {
			declared = declared.filter((d) => d.name !== removal.name);
			return;
		}
		if (removal.kind === 'refused') return;
		const f = formulas.find((x) => rowKey(x) === removal.key);
		if (!f) return;
		if (removal.kind === 'stop-reading') void stopReading(f);
		else remove(f);
	}

	/** Keep the site and the visit in the URL, so a calculation read at a visit is a link. */
	function rememberVisit() {
		const url = new URL(page.url);
		for (const [key, value] of [
			['site', siteId],
			['visit', visitId],
		]) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	async function loadVisits(site: string, keep = '') {
		visits = [];
		visitId = '';
		run = null;
		if (!site) {
			rememberVisit();
			return;
		}
		visitsLoading = true;
		try {
			visits = await listVisitsHolding(site, readIds);
			visitId = visitToOpen(visits, keep);
			if (visitId) await runAtVisit();
		} catch (e) {
			runError = e instanceof Error ? e.message : 'Failed to load visits';
		} finally {
			visitsLoading = false;
			rememberVisit();
		}
	}

	/** Choosing a visit reads the calculation over it: the numbers are the page. */
	function chooseVisit() {
		rememberVisit();
		run = null;
	}

	/**
	 * Read the set as it stands. Nothing is written: `draft_run` computes and returns, and a run
	 * with no visit is on the typed numbers alone.
	 *
	 * Responses are tagged, so one that was launched earlier never replaces a later one's numbers.
	 */
	async function runAtVisit() {
		const seq = ++requests;
		const at = generation;
		running = true;
		runError = '';
		try {
			const result = await draftRunFormulas(
				calculationId,
				draftRunBody(
					formulas,
					visit ? { siteId, collectedAt: visit.collected_at } : null,
					replicateText,
					Object.fromEntries(slots.map((slot) => [slot, curveField(curveChoice[slot])])),
					scalarOverrides(inputs, scalarText),
				),
			);
			if (seq !== requests) return;
			run = result;
			ranAt = at;
		} catch (e) {
			if (seq !== requests) return;
			run = null;
			runError = e instanceof Error ? e.message : 'The run was refused';
		} finally {
			if (seq === requests) running = false;
		}
	}

	/**
	 * The recorded run a link named, drawn as it ran. Reading it also pins the signature, so the
	 * rerun effect leaves it alone until the person changes the set, the visit or an input.
	 */
	async function openRecorded(runId: string) {
		try {
			recorded = await getToolRunTrace(runId);
			lastSignature = runSignature;
			if (recorded.site_id) siteId = recorded.site_id;
		} catch (e) {
			runError = e instanceof Error ? e.message : 'That run could not be replayed';
		}
	}

	/** Leave the recorded run and read the set as it stands now. */
	function runAgain() {
		recorded = null;
		void runAtVisit();
	}

	/** The runs of this calculation at the chosen visit, so a reader can move between them. */
	async function loadRunsAtVisit() {
		runsAtVisit = [];
		if (!calculation || !siteId || !visit) return;
		try {
			const rows = await api.toolRuns.list({
				perPage: 50,
				sort: ['created_at', 'DESC'],
				filter: {
					tool_name: calculation.name,
					site_id: siteId,
					collected_at: visit.collected_at,
				},
			});
			runsAtVisit = rows.data;
		} catch {
			runsAtVisit = [];
		}
	}

	const ledgerRows = $derived(ledgerLines(ledger, publishedOutputs, base));

	const history = $derived(
		historyPanes({
			runs: runsAtVisit.length,
			ledger: ledgerRows.length,
			reference: reference.length,
			versions: calculation?.versions.length ?? 0,
		}),
	);
	let historyTab = $state<HistoryKey | null>(null);
	let barHeight = $state(0);
	const historyKey = $derived(openPane(history, historyTab));
	const historyIndex = $derived(Math.max(0, history.findIndex((h) => h.key === historyKey)));

	/** What a run reads, so a change to any of it is a change to the numbers on screen. */
	const runSignature = $derived(
		JSON.stringify([
			formulas.map((f) => [f.code, f.formula, f.per_replicate, f.curve_slot, f.intermediate]),
			replicateText,
			scalarText,
			siteId,
			visitId,
			slots.map((slot) => curveField(curveChoice[slot])),
		]),
	);
	let lastSignature = '';
	// A change reruns the draft once it has settled, rather than on every keystroke, and waits while
	// the formula being typed does not parse.
	$effect(() => {
		const next = runSignature;
		if (diagnostics.length > 0) {
			// A run already waiting was scheduled for text that has since stopped parsing.
			if (rerunTimer) clearTimeout(rerunTimer);
			rerunTimer = null;
			lastSignature = '';
			return;
		}
		if (loading || next === lastSignature) return;
		lastSignature = next;
		if (ordered.length === 0) return;
		// An edit is what replaces the recorded result with a fresh one; arriving on it does not.
		recorded = null;
		generation += 1;
		scheduled = generation;
		if (rerunTimer) clearTimeout(rerunTimer);
		rerunTimer = setTimeout(() => {
			rerunTimer = null;
			void runAtVisit();
		}, 400);
	});

	// The runs at the visit follow whichever visit is chosen, the deep link's included.
	$effect(() => {
		void visitId;
		void siteId;
		void loadRunsAtVisit();
	});

	const inputCls =
		'w-full px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface text-brand-text';
</script>

<svelte:head>
	<title>{calculation ? calculation.label || calculation.name : 'Calculation'} - River Data</title>
</svelte:head>

<div class="space-y-4">
	<div>
		<Breadcrumbs items={[{ label: 'Toolbox', href: `${base}/toolbox` }, { label: calculation?.label || calculation?.name || 'Calculation' }]} />
		<div class="flex items-start justify-between gap-3 flex-wrap">
			<div>
				<h2 class="text-xl font-semibold">{calculation?.label || calculation?.name || 'Calculation'}</h2>
				{#if calculation}
					<p class="text-sm text-brand-muted">
						{calculation.name} · formula calculation
						{#if calculation.active_version_no}· version {calculation.active_version_no}{/if}
					</p>
					{#if calculation.description}<p class="text-sm text-brand-muted mt-1">{calculation.description}</p>{/if}
					<CalculationSites name={calculation.name} />
					<div class="mt-2"><DecommissionBanner {calculation} /></div>
				{/if}
			</div>
		</div>
		{#if calculation}
			<details class="mt-2 rounded-md border border-brand-divider bg-brand-surface">
				<summary class="px-3 py-2 text-sm font-medium cursor-pointer">
					Calculation: label, description, on or off
				</summary>
				<div class="p-3">
					<CalculationSettings {calculation} onsaved={refreshCalculation} />
				</div>
			</details>
		{/if}
	</div>

	{#if error}
		<ErrorNotice message={error} />
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		<!-- Kept in view: the site and the visit the whole page reads, and the save, from wherever
		     the author is on it. -->
		<div bind:clientHeight={barHeight} class="sticky top-0 z-20 rounded-md border border-brand-divider bg-brand-surface px-3 py-2 space-y-1">
			<div class="flex flex-wrap items-end gap-3">
				<label class="text-xs text-brand-muted">Site
					<SiteSelect
						bind:value={siteId}
						sites={siteChoices}
						note={(s) => noteById.get(s.id) ?? ''}
						class="block mt-0.5 {inputCls}"
						onchange={(s) => loadVisits(s)}
					/>
				</label>
				<label class="text-xs text-brand-muted">Visit
					<select bind:value={visitId} onchange={chooseVisit} disabled={!siteId || visitsLoading} class="block mt-0.5 {inputCls} min-w-56">
						<option value="">{visitsLoading ? 'Loading…' : visits.length === 0 ? 'No visit holds every input' : 'Choose a visit…'}</option>
						{#each visits as v (v.id)}
							<option value={v.id}>{formatDateTime(v.collected_at)} · {v.parameters_filled} filled</option>
						{/each}
					</select>
				</label>
				{#if running}<span class="text-xs text-brand-muted pb-1">Reading…</span>{/if}
				<div class="flex-1"></div>
				<div class="flex flex-wrap items-center gap-2 pb-0.5">
					{#if unsaved}
						<span class="text-xs text-brand-muted">
							Unsaved: {ownCount} formula{ownCount === 1 ? '' : 's'}{dropped.length > 0 ? `, dropping ${dropped.map((f) => f.code).join(', ')}` : ''}
						</span>
						<Button size="sm" variant="primary" loading={busy} disabled={busy || diagnostics.length > 0} title={saveBlocked} onclick={() => saveSet()}>Save as a new version</Button>
					{:else}
						<span class="text-xs text-brand-muted">Saved. The calculation runs as its active version.</span>
					{/if}
				</div>
			</div>
			<p class="text-xs text-brand-muted">
				The set runs over the visit's stored values as the formulas stand, unsaved edits included, and
				writes nothing. Type a number into an input cell to read it over that instead; with no visit
				chosen the run is on the typed numbers alone.
			</p>
			{#if unsaved}
				<p class="text-xs text-brand-muted">Saving writes the whole set as one version, whatever it changed.{supersedes ? ` ${versionConsequence(activeUsage)}` : ''}</p>
			{/if}
		</div>

		{#if takingOver.length > 0}
			<div role="alertdialog" aria-label="Take over a column" class="rounded-md border border-severity-warning bg-brand-surface px-3 py-2 space-y-2">
				{#each takingOver as take (take.code)}
					<p class="text-sm">{takeoverLine(take, formatDate)}</p>
				{/each}
				<div class="flex flex-wrap gap-2">
					<Button size="sm" variant="primary" loading={busy} onclick={() => saveSet(takingOver.map((t) => t.code))}>Take over and save</Button>
					<Button size="sm" variant="ghost" onclick={() => (takingOver = [])}>Keep editing</Button>
				</div>
			</div>
		{/if}
		{#if runError}<ErrorNotice message={runError} />{/if}
		{#if !recorded && run && !run.ran && run.failure}
			<ErrorNotice message={run.failure.message} />
		{/if}
		{#each givenUp as gone (gone.parameter_id)}
			<!-- Ticking an output as a step stops publication and deletes nothing. -->
			<div class="rounded-md border border-brand-divider bg-brand-surface px-3 py-2">
				<p class="text-sm">
					<span class="font-mono">{gone.code}</span> is a step now, so the calculation no longer publishes it.
					{gone.readings_retained} reading{gone.readings_retained === 1 ? '' : 's'} stay under the parameter, and ticking it back as an output publishes them again.
				</p>
				{#if gone.read_by.length > 0 || gone.sites.length > 0}
					<p class="text-xs text-brand-muted">
						{#if gone.read_by.length > 0}Read by {gone.read_by.join(', ')}.{/if}
						{#if gone.sites.length > 0} Held at {gone.sites.join(', ')}.{/if}
					</p>
				{/if}
			</div>
		{/each}
		{#if recorded}
			<!-- A recorded result stands until the reader changes something or asks for a fresh one:
			     this is the number that was stored, not one computed now. -->
			<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-divider bg-brand-surface px-3 py-2">
				<p class="text-sm">
					The run of {formatDateTime(recorded.collected_at ?? '')} as it ran, under version {recorded.version_no}.
					{#if Number.isInteger(anchorIndex)}Replicate {anchorIndex}.{/if}
				</p>
				<Button size="sm" onclick={runAgain} disabled={!visit}>Run the set as it stands</Button>
			</div>
		{/if}

		<!-- The set over the chosen site's streams, a compact strip above the sheet; moving along the
		     chart fills the tables at that instant. -->
		{#if blocker}
			<p class="text-xs text-brand-muted">This runs at field visits only: it reads {blocker}.</p>
		{:else}
			<LivePreview
				formulas={previewSet}
				{siteId}
				sites={sitesWithAvailability}
				constantNames={constants.map((c) => c.name)}
				reads={readsAtSite}
				onhover={(at) => (hovered = at)}
			/>
		{/if}

		<!-- The calculation as tables of the visit's data, with the selected cell and the palette in a
		     pane beside them, so opening a cell leaves the sheet where it is. -->
		<div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_24rem] gap-4 items-start">
			<div class="min-w-0 space-y-4">
			<section class="min-w-0 rounded-md border border-brand-divider bg-brand-surface">
				<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-brand-divider">
					<div>
						<h3 class="text-sm font-semibold">{hovered ? 'At this instant' : 'At this visit'}</h3>
						{#if hovered}
							<p class="text-xs text-brand-muted">{formatDateTime(hovered.time)}, read from the series above.</p>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#if shareable.length > 0}
							<select bind:value={declaring} class={inputCls} aria-label="A step written elsewhere">
								<option value="">Bring in a step…</option>
								{#each shareable as offer (offer.id)}
									<option value={offer.id} title="{offer.code} = {offer.formula}">{offer.label}</option>
								{/each}
							</select>
							<Button size="sm" disabled={busy || !declaring} onclick={declare}>Bring in</Button>
						{/if}
					</div>
				</div>
				{#if offered}
					<div class="px-3 py-2 border-b border-brand-divider text-xs" aria-label="What bringing in {offered.code} shares">
						<p class="text-brand-muted">
							{offered.owner ? `Written by ${offered.owner}; bringing it in shares it` : 'Already shared'}{offered.chain.length > 0 ? ' with the steps it reads:' : '.'}
						</p>
						<ul class="mt-1 space-y-0.5 font-mono">
							{#each [...offered.chain, offered] as step (step.code)}
								<li><span class="font-semibold">{step.code}</span> = {step.formula}</li>
							{/each}
						</ul>
					</div>
				{/if}
				<div class="px-3 py-3 space-y-3">
					<CalculationSheet
						{blocks}
						{formulas}
						trace={run?.trace ?? []}
						{stale}
						bind:selected
						onselect={choose}
						onedit={applyEdit}
						ondrop={dropPayload}
						onadd={addRow}
						onsteps={(on) => (showSteps = on)}
						onremove={removeRow}
						declared={declared.map((d) => d.name)}
					/>
					{#if (run?.skipped?.length ?? 0) > 0}
						<ul class="text-xs text-brand-muted">
							{#each run?.skipped ?? [] as s, i (i)}
								<li><span class="font-mono">{s.output}</span> not run: {s.reason}</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>
			</div>
			<!-- Held under the site and visit bar, which is sticky too. -->
			<div
				class="min-w-0 space-y-4 xl:sticky xl:top-(--pane-top) xl:max-h-[calc(100vh-var(--pane-top)-4rem)] xl:overflow-y-auto"
				style="--pane-top: {barHeight + 16}px"
			>
			<CellPanel
				bind:this={cellPanel}
				row={selectedRow}
				selection={selected}
				bind:formula={picked}
				bind:focused
				{formulas}
				variables={paramVars}
				{constants}
				trace={run?.trace ?? []}
				bind:diagnostics
				consequence={supersedes ? versionConsequence(activeUsage) : null}
				dependents={picked?.id ? (dependents[picked.id] ?? null) : null}
				{busy}
				onselect={choose}
				onedited={() => visit && runAtVisit()}
				ondrop={remove}
				onstopreading={stopReading}
				onshowdependents={showDependents}
			/>
			<section aria-label="Palette" class="rounded-md border border-brand-divider bg-brand-surface">
				<FormulaPalette
					variables={paramVars}
					{constants}
					onpick={insert}
					class="p-2 max-h-[460px] overflow-y-auto"
				/>
			</section>
			</div>
		</div>

		{#if slots.length > 0}
			<!-- What binds `curve_slope` and `curve_intercept` for the run. Unbound, the slot's
			     formulas are skipped for want of coefficients. -->
			<section class="rounded-md border border-brand-divider bg-brand-surface">
				<h3 class="px-3 py-2 text-sm font-semibold border-b border-brand-divider">
					Curve slots<span class="ml-2 text-xs font-normal text-brand-muted">the coefficients the run reads, chosen at the site above</span>
				</h3>
				<div class="px-3 py-3 grid gap-3 sm:grid-cols-2">
					{#each slots as slot (slot)}
						<CurvePicker
							title="Curve slot {slot}"
							siteId={siteId || null}
							bind:value={
								() => curveChoice[slot] ?? emptyCurveSelection(),
								(v) => (curveChoice = { ...curveChoice, [slot]: v })
							}
						/>
					{/each}
				</div>
			</section>
		{/if}

		{#if history.length > 0}
			<!-- What the calculation has already done and where it came from, one tab each beside the
			     working surface rather than stacked under it. -->
			<section class="rounded-md border border-brand-divider bg-brand-surface">
				<Tabs
					tabs={history.map((h) => h.label)}
					bind:active={() => historyIndex, (i) => (historyTab = history[i]?.key ?? null)}
				/>
				{#if historyKey === 'runs'}
				<!-- Every run of this calculation at the visit: what was computed here, and when. -->
				<p class="px-3 pt-2 text-xs text-brand-muted">Each one opens as it ran.</p>
				<ul class="divide-y divide-brand-divider">
					{#each runsAtVisit as row (row.id)}
						<li class="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
							<a
								class="text-brand-primary hover:underline"
								href={`${base}/toolbox/${encodeURIComponent(calculationId)}?site=${encodeURIComponent(siteId)}&visit=${encodeURIComponent(visitId)}&run=${encodeURIComponent(row.id)}`}
								aria-current={recorded?.run_id === row.id ? 'true' : undefined}
							>{formatDateTime(row.created_at)}</a>
							<span class="text-xs text-brand-muted">{row.source} · {row.created_by}</span>
						</li>
					{/each}
				</ul>
				{:else if historyKey === 'ledger'}
				<!-- What this calculation has computed on the stream arm. A continuous evaluation records
				     no identity of its own, so a row is one pinned version, however many passes wrote
				     under it (Q232). -->
				<p class="px-3 pt-2 text-xs text-brand-muted">What each version has already written.</p>
				<ul class="divide-y divide-brand-divider">
					{#each ledgerRows as line (line.versionId)}
						<li class="px-3 py-2 text-sm">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="font-medium">Version {line.versionNo}</span>
								<span class="text-xs text-brand-muted">
									{line.readings} reading{line.readings === 1 ? '' : 's'}
									{#if line.span}
										· {formatDateTime(line.span.from)} to {formatDateTime(line.span.to)}
									{/if}
								</span>
							</div>
							{#if line.links.length > 0}
								<p class="mt-1 text-xs">
									{#each line.links as link, i (link.href)}
										{#if i > 0}<span class="text-brand-muted"> · </span>{/if}
										<a class="text-brand-primary hover:underline" href={link.href} title="Open the readings this version wrote, where a row opens its record">{link.code}</a>
									{/each}
								</p>
							{:else}
								<p class="mt-1 text-xs text-brand-muted">Nothing stored under this version.</p>
							{/if}
						</li>
					{/each}
				</ul>
				{:else if historyKey === 'reference'}
				<!-- How the portal produced these codes, carried by the plan that paired them. -->
				<p class="px-3 pt-2 text-sm font-medium">How the portal produced these codes</p>
				<p class="px-3 text-xs text-brand-muted">Check this calculation's results against these, as the pairing plan recorded them.</p>
				<ul class="divide-y divide-brand-divider">
					{#each reference as recorded (recorded.code)}
						<li class="px-3 py-2 text-sm">
							<span class="font-mono">{recorded.code}</span>
							{#if isReplicateStatistic(recorded)}
								<span class="text-brand-muted"> is {referenceText(recorded)}</span>
							{:else}
								<span class="text-brand-muted"> = </span>
								<span class="font-mono">{referenceText(recorded)}</span>
							{/if}
							{#if referenceOrigin(recorded)}
								<p class="text-xs text-brand-muted">From {referenceOrigin(recorded)}</p>
							{/if}
						</li>
					{/each}
				</ul>
				{:else if historyKey === 'versions'}
				<!-- Version history: which of them the record's values were computed under. -->
				<p class="px-3 pt-2 text-xs text-brand-muted">Every save mints one, and each holds the values computed while it was active.</p>
				<ul class="divide-y divide-brand-divider">
					{#each calculation?.versions ?? [] as version (version.id)}
						<li class="px-3 py-2 text-sm flex items-start justify-between gap-3 flex-wrap">
							<div>
								<span class="font-medium">Version {version.version_no}</span>
								{#if version.active}<Badge variant="ok">active</Badge>{/if}
								<span class="text-xs text-brand-muted"> · {formatDateTime(version.created_at)}{version.created_by ? ` · ${version.created_by}` : ''}</span>
								{#if version.note}<p class="text-xs text-brand-muted">{version.note}</p>{/if}
							</div>
							<span class="text-xs text-brand-muted">{storedLabel(usageByVersion.get(version.id)) || 'counting…'}</span>
						</li>
					{/each}
				</ul>
				{/if}
			</section>
		{/if}
	{/if}
</div>
