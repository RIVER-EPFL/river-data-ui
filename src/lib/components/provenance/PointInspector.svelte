<script lang="ts">
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import { visitHref } from '$lib/visits/link';
	import {
		getReadingProvenance,
		type ProvenanceResponse,
		type ProvenanceRecord,
		type ProvenanceReading,
		type ProvenanceCalibrationRef,
		type ProvenanceCalculation,
		replayDerived,
		type ReplayResult,
		getReadingLedger,
		rollbackEdit,
		reopenReplicateAudit,
		type LedgerEntry,
		type ConsumedInput,
	} from '$api/service';
	import { TAG_KINDS, holdHref as holdLinkHref, type HoldLink } from '$lib/holds';
	import type { SampleReplicate } from '$api/types';
	import { replicatesOf } from '$lib/provenance/replicates';
	import { curveLabel, formatEquation } from '$lib/standardCurves';
	import { classificationLabel, originPhrase, provenanceKindLabel } from '$lib/origin';
	import { NO_VALUE, formatCount, formatMeasurement, numericCell } from '$lib/format';
	import { formatCompactInstant, formatDateTime } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ProvenanceCard from '$components/samples/ProvenanceCard.svelte';
	import EditReadingDialog from '$components/dialogs/EditReadingDialog.svelte';
	import RollbackDialog from '$components/provenance/RollbackDialog.svelte';
	import {
		decisionLabel,
		fieldLabel,
		restoredLines,
		rulingHold,
		undoable,
		type DecisionEntry,
	} from '$lib/provenance/decisions';
	import { historyRows, leadingToken, type HistoryRow } from '$lib/provenance/ledger';
	import { decommissionText, recordDecommission } from '$lib/provenance/decommission';
	import { takeoverText } from '$lib/provenance/takeover';
	import { originServiceHref } from '$lib/provenance/serviceLink';
	import { computedOrigin, valueLabel } from '$lib/provenance/recordLabels';
	import {
		anyChanged,
		captureLine,
		consumedText,
		kindLabel,
		markTip,
		markVariant,
		memberHref,
		slotHref,
		orderedInputs,
	} from '$lib/provenance/consumed';
	import { calculationHref, type ComputationAnchor } from '$lib/toolbox/route';
	import { me } from '$auth/me.svelte';

	// The record of one measured instant, pinned in place under its chart or table row.
	let {
		siteId,
		parameterId,
		parameterName,
		units = null,
		decimals = null,
		timeIso,
		measurementType,
		preloaded = null,
		revision = 0,
		link = null,
		onclose,
		onchange,
		onflag,
	}: {
		siteId: string;
		parameterId: string;
		parameterName: string;
		/** The unit the slot serves. Printed on the value columns; the caller resolves it. */
		units?: string | null;
		/** `site_parameters.decimal_places`; null falls back to significant digits. */
		decimals?: number | null;
		timeIso: string;
		measurementType?: string;
		/** The record the caller already holds (a visit's detail); given, nothing is fetched. */
		preloaded?: ProvenanceResponse | null;
		/** Bumped by the caller after a curation write, so a fetched record re-reads itself. */
		revision?: number;
		/** The address of this record, offered as a copy action. */
		link?: string | null;
		onclose?: () => void;
		/** Called after a curation write from inside the panel, so the caller re-reads its own rows. */
		onchange?: () => void;
		// Shown as a "Flag replicates" action on a spot group, handed the group's replicates.
		onflag?: (replicates: SampleReplicate[]) => void;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	// A curation write from inside the panel outdates the caller's record, so the panel fetches its
	// own from then on. Not reactive: `load()` reads it, and the mount effect resets it.
	let ownRecord = false;
	let resp = $state<ProvenanceResponse | null>(null);
	let showToolRun = $state<Set<number>>(new Set());
	/// The arithmetic behind a derived value, read on request: the formula the computation
	/// recorded, over the values it recorded. Keyed by the record it belongs to.
	let replays = $state<Record<number, ReplayResult | { error: string }>>({});
	// The history of each record, read with the record: every dated thing that happened to it, the
	// decisions riding on their entries so each row can be rolled back from this one read.
	let history = $state<Record<number, LedgerEntry[]>>({});
	let historyError = $state<Record<number, string>>({});
	let severity = $state<'all' | 'error' | 'warning'>('all');
	let rollingBack = $state<string | null>(null);
	let editOpen = $state(false);
	let editSelection = $state<{ keys: { stream_id: string; time: string }[] } | null>(null);
	let editInitial = $state<'override' | null>(null);

	// The severity is the one filter, and the endpoint applies it, so changing it re-reads every
	// record already open rather than hiding rows it already holds.
	async function filterBy(level: 'all' | 'error' | 'warning') {
		severity = level;
		await loadAllHistory();
	}

	async function loadAllHistory() {
		for (const [i, rec] of (resp?.records ?? []).entries()) await loadHistory(i, rec);
	}

	/** Where an entry lives, for the records that have a page of their own. */
	function entryHref(rec: ProvenanceRecord, entry: LedgerEntry): string | null {
		switch (entry.source) {
			// A timeline line is keyed by its job, so both arms open the same run with its log.
			case 'job':
			case 'job_log':
				return `${base}/system?tab=jobs&job=${entry.id}`;
			case 'hold': {
				// A hold the record no longer lists is terminal; its kind leads the entry's text.
				const held = rec.holds.find((h) => h.id === entry.id);
				return holdHref(rec, held ?? { id: entry.id, kind: leadingToken(entry.what), status: 'resolved' });
			}
			case 'ingest':
			case 'arrival':
			case 'pairing':
				return `${base}/streams?q=${encodeURIComponent(rec.origin.source_key)}`;
			case 'alarm':
				return `${base}/alarms`;
			default:
				return null;
		}
	}

	function openTitle(entry: LedgerEntry): string {
		switch (entry.source) {
			case 'job':
			case 'job_log':
				return 'Open this job and its log';
			case 'hold':
				return 'Open this hold in the review queue';
			case 'ingest':
				return 'Open the stream this pass wrote';
			case 'alarm':
				return 'Open the alarms';
			default:
				return 'Open';
		}
	}

	function cellText(v: unknown): string {
		if (typeof v === 'number') return fmt(v);
		return rawText(v);
	}

	function rawText(v: unknown): string {
		if (v === null || v === undefined || v === '') return NO_VALUE;
		return typeof v === 'string' ? v : JSON.stringify(v);
	}

	function memberRows(e: DecisionEntry): string {
		const rows = e.members
			.map((m) => (m.replicate_index === null || m.replicate_index === undefined ? 'the group' : `replicate ${m.replicate_index}`))
			.join(', ');
		return `One act over ${rows}`;
	}

	async function loadHistory(i: number, rec: ProvenanceRecord) {
		try {
			const ledger = await getReadingLedger({
				stream_id: rec.origin.stream_id,
				time: timeIso,
				...(severity === 'all' ? {} : { severity }),
			});
			history = { ...history, [i]: ledger.entries };
			historyError = { ...historyError, [i]: '' };
		} catch (e) {
			historyError = {
				...historyError,
				[i]: e instanceof Error ? e.message : String(e),
			};
		}
	}

	// A rollback is offered at two scopes (Q223): this reading, which inverts the entry's decisions
	// here, and the edit that recorded it, which inverts every decision of its set on whichever
	// streams it reached. Each names what it puts back before it runs.
	let recovery = $state<{
		i: number;
		rec: ProvenanceRecord;
		entry: DecisionEntry;
		lines: string[];
		loading: boolean;
		error: string;
	} | null>(null);
	let recoveryOpen = $state(false);

	function askRollback(i: number, rec: ProvenanceRecord, entry: DecisionEntry) {
		const code = resp?.parameter_code ?? parameterName ?? null;
		recovery = {
			i,
			rec,
			entry,
			lines: restoredLines(entry.members.map((decision) => ({ decision, parameter_code: code }))),
			loading: false,
			error: '',
		};
		recoveryOpen = true;
	}

	async function rollBack() {
		if (!recovery) return;
		const { i, rec, entry } = recovery;
		rollingBack = entry.head.id;
		try {
			for (const d of entry.members.filter((m) => !m.rolled_back_by)) await rollbackEdit(d.id);
			toastStore.success(`${decisionLabel(entry.head.kind)} rolled back`);
			recoveryOpen = false;
			await loadHistory(i, rec);
			await changed();
		} catch (e) {
			recovery = { ...recovery, error: e instanceof Error ? e.message : String(e) };
		} finally {
			rollingBack = null;
		}
	}

	// A manager's ruling is undone by reopening its hold, which rolls back its decisions and returns
	// the hold, the visit and the holds it closed to the review queue together.
	async function reopenRuling(i: number, rec: ProvenanceRecord, e: DecisionEntry, hold: string) {
		rollingBack = e.head.id;
		try {
			await reopenReplicateAudit(hold);
			toastStore.success('Ruling reopened');
			await loadHistory(i, rec);
			await changed();
		} catch (err) {
			historyError = {
				...historyError,
				[i]: err instanceof Error ? err.message : String(err),
			};
		} finally {
			rollingBack = null;
		}
	}

	// What every write from inside the panel does: re-read this record, and tell the caller to
	// re-read what it drew from its own copy.
	async function changed() {
		ownRecord = true;
		await load();
		onchange?.();
	}

	function openEdit(rec: ProvenanceRecord, initial: 'override' | null = null) {
		editSelection = { keys: [{ stream_id: rec.origin.stream_id, time: timeIso }] };
		editInitial = initial;
		editOpen = true;
	}

	// A calculated value an administrator may still replace by hand: one no override stands on.
	function overridable(rec: ProvenanceRecord): boolean {
		return (
			me.can('admin') &&
			rec.computation?.provenance != null &&
			!rec.readings.some((r) => r.overridden)
		);
	}

	function overrideText(r: ProvenanceReading): string {
		const o = r.overridden;
		if (!o) return NO_VALUE;
		const replica = r.replicate_index > 0 ? `Replicate ${r.replicate_index} overridden` : 'Overridden';
		const computed = o.computed_value == null ? '' : `; the calculation gave ${fmt(o.computed_value)}`;
		const why = o.reason ? ` (${o.reason})` : '';
		return `${replica} by hand by ${o.by} on ${formatDateTime(o.at)}${computed}${why}.`;
	}

	// The server may name a kind this build does not know, so the lookup falls back to it.
	const HOLD_LABEL: Record<string, string> = {
		replicate_stats: 'Statistics disagreement',
		source_modified: 'Source modified curated data',
		brake_fired: 'Reconciliation brake',
		missing_output: 'Missing tool output',
		stale_output: 'Stale tool output',
		skipped_output: 'Calculation did not run',
		curve_claim_stripped: 'Curve claim stripped',
		unverified_entry: 'Entered and not yet verified',
		source_identity_changed: 'The feed reports a different device',
	};

	function fmt(v: number | null | undefined): string {
		return formatMeasurement(v, decimals);
	}

	const unitSuffix = $derived(units ? ` (${units})` : '');
	// Each fact is a label above its value; the groups share one grid across the record's width.
	const factsClass = 'mt-2 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-6 gap-y-2';
	const lineClass = 'contents';
	const gridClass = factsClass;

	function cadence(rec: ProvenanceRecord): string {
		return rec.readings[0]?.measurement_type ?? 'continuous';
	}

	// A record something computed: a derived value, or one a tool run saved. The consumed set is
	// only claimed about these, and one of them with an empty set was computed before the capture
	// existed, so what it read is unknown rather than nothing.
	function computed(rec: ProvenanceRecord): boolean {
		return cadence(rec) === 'derived' || rec.computation?.provenance != null;
	}

	function calibrationWindow(c: ProvenanceCalibrationRef): string {
		return `valid ${formatDateTime(c.valid_from)} to ${c.valid_until ? formatDateTime(c.valid_until) : 'open'}`;
	}

	function stateText(r: ProvenanceReading): string {
		if (r.withdrawn_at) return `withdrawn${r.withdrawn_reason ? `: ${r.withdrawn_reason}` : ''}`;
		if (r.is_flagged) return `flagged${r.flag_reason ? `: ${r.flag_reason}` : ''}`;
		if (r.unverified) return 'pending';
		return NO_VALUE;
	}

	function stateTip(r: ProvenanceReading): string | undefined {
		if (r.withdrawn_at) return `Withdrawn ${formatDateTime(r.withdrawn_at)}; the source no longer claims this value.`;
		if (r.unverified) return 'Entered and not yet verified: no statistic counts it and it is served nowhere.';
		return undefined;
	}

	// When the value on display arrived, which is the correction that wrote it where there is one.
	// `ingested_at` is the row's first arrival and nothing moves it.
	function arrivedText(r: ProvenanceReading): string {
		const at = r.value_arrived_at ?? r.ingested_at;
		return at ? formatDateTime(at) : NO_VALUE;
	}

	// Every reading says where it came from, whether its story is stored on the row (a tool run, a
	// chain, a CSV import, a hand entry, a batch) or resolved from what the row points at.
	function originText(r: ProvenanceReading): string {
		return provenanceKindLabel(r.provenance_kind) ?? NO_VALUE;
	}

	function instrumentText(rec: ProvenanceRecord): string {
		const s = rec.chain.sensor;
		if (!s) return NO_VALUE;
		const make = [s.manufacturer, s.model].filter(Boolean).join(' ');
		// Named first: a source-registered instrument carries no serial, and its name says which
		// site and parameter it serves.
		const label = `${s.name ?? s.serial_number ?? s.id}${make ? ` (${make})` : ''}`;
		const d = rec.chain.deployment;
		if (!d) return label;
		const until = d.deployed_until ? formatDateTime(d.deployed_until) : 'open';
		return `${label}, ${d.site_name ?? 'site'} ${formatDateTime(d.deployed_from)} to ${until}`;
	}

	// The calibration and curve the whole record was made with, where every replicate agrees on
	// them. Null when they differ: then only the replicate table can say which is which.
	function sharedApplied(rec: ProvenanceRecord): ProvenanceReading | null {
		const first = rec.readings[0];
		if (!first) return null;
		const same = rec.readings.every(
			(r) =>
				(r.calibration?.id ?? null) === (first.calibration?.id ?? null) &&
				(r.standard_curve?.id ?? null) === (first.standard_curve?.id ?? null),
		);
		return same ? first : null;
	}

	/** How many replicates are in each state, for the chips the strip carries instead of a column. */
	function stateCounts(rec: ProvenanceRecord): { label: string; n: number }[] {
		const counts = [
			{ label: 'withdrawn', n: rec.readings.filter((r) => r.withdrawn_at).length },
			{ label: 'flagged', n: rec.readings.filter((r) => !r.withdrawn_at && r.is_flagged).length },
			{ label: 'pending', n: rec.readings.filter((r) => !r.withdrawn_at && !r.is_flagged && r.unverified).length },
		];
		return counts.filter((c) => c.n > 0);
	}

	function computationText(rec: ProvenanceRecord): string {
		if (rec.calculation) return calculationText(rec.calculation);
		if (!rec.computation?.provenance) return NO_VALUE;
		const src = rec.computation.run_source;
		if (src === 'chain') return 'recomputed by chain';
		if (src && src !== 'interactive') return src;
		return 'tool run';
	}

	/// Which historical result the calculation link opens on: the formula's own row, the run that
	/// produced the value, and the replicate the reader is looking at. A group of several
	/// replicates names none of them, so the link opens on the row and no further.
	function computationAnchor(rec: ProvenanceRecord): ComputationAnchor {
		const run = (rec.computation?.provenance as Record<string, unknown> | undefined)?.run_id;
		return {
			cell: rec.calculation?.code ?? null,
			run: typeof run === 'string' ? run : null,
			index: rec.readings.length === 1 ? (rec.readings[0]?.replicate_index ?? null) : null,
		};
	}

	function computationTip(rec: ProvenanceRecord): string {
		if (rec.calculation) return calculationTip(rec.calculation);
		return rec.computation?.provenance
			? 'Computed by a recorded tool run; open it from the actions below.'
			: 'Hand-entered measurement, no tool run recorded.';
	}

	// A formula's counterpart of a run: the calculation, and the version of it this value carries.
	function calculationText(calc: ProvenanceCalculation): string {
		if (!calc.version_no) return `${calc.code}, formula not recoverable`;
		const older =
			calc.active_version_no && calc.active_version_no > calc.version_no
				? `, now at v${calc.active_version_no}`
				: '';
		return `${calc.code} v${calc.version_no}${older}`;
	}

	function calculationTip(calc: ProvenanceCalculation): string {
		if (!calc.formula)
			return 'Computed by a formula, from before formulas were versioned: the text that produced this value is not recoverable.';
		const older =
			calc.active_version_no && calc.active_version_no > (calc.version_no ?? 0)
				? ' The calculation has been edited since.'
				: '';
		return `Computed by ${calc.name}: ${calc.formula}.${older}`;
	}

	function isTag(h: ProvenanceRecord['holds'][number]): boolean {
		return (TAG_KINDS as string[]).includes(h.kind);
	}

	function holdTip(h: ProvenanceRecord['holds'][number]): string {
		const opens = isTag(h)
			? 'Opens the discrepancies recorded at this instant.'
			: 'Opens where this is worked.';
		return `Raised ${formatDateTime(h.created_at)}. ${opens}`;
	}

	function holdHref(rec: ProvenanceRecord, h: HoldLink): string {
		return holdLinkHref(base, h, {
			siteId,
			parameterId,
			timeIso,
			eventId: rec.event?.id,
			streamId: rec.origin.stream_id,
			sensorId: rec.chain.sensor?.id,
		});
	}

	async function copyLink() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			toastStore.success('Link copied');
		} catch {
			toastStore.error('Could not copy the link');
		}
	}

	function flaggable(rec: ProvenanceRecord): boolean {
		return rec.readings.some((r) => r.measurement_type === 'spot');
	}

	async function load() {
		if (preloaded && !ownRecord) {
			resp = preloaded;
			loading = false;
			void loadAllHistory();
			return;
		}
		loading = true;
		try {
			resp = await getReadingProvenance({
				time: timeIso,
				site_id: siteId,
				parameter_id: parameterId,
				measurement_type: measurementType,
			});
			error = '';
		} catch (e) {
			resp = null;
			error = e instanceof Error ? e.message : 'Could not load the record';
		} finally {
			loading = false;
		}
		void loadAllHistory();
	}

	$effect(() => {
		const key = `${siteId}|${parameterId}|${timeIso}|${measurementType ?? ''}|${revision}`;
		void key;
		showToolRun = new Set();
		history = {};
		replays = {};
		error = '';
		ownRecord = false;
		// The key above is the whole dependency: what the load reads must not re-run it.
		untrack(() => void load());
	});

	/// Ask for a derived record's own arithmetic. It is read once per record and kept, because
	/// the captured set does not move.
	async function showReplay(i: number, rec: ProvenanceRecord) {
		if (replays[i]) return;
		const first = rec.readings[0];
		if (!first) return;
		try {
			replays = {
				...replays,
				[i]: await replayDerived({
					stream_id: rec.origin.stream_id,
					time: timeIso,
					replicate_index: first.replicate_index ?? 0,
				}),
			};
		} catch (e) {
			replays = {
				...replays,
				[i]: { error: e instanceof Error ? e.message : 'The replay was refused' },
			};
		}
	}

	function toggleToolRun(i: number) {
		const next = new Set(showToolRun);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		showToolRun = next;
	}

	function originBadge(rec: ProvenanceRecord): { label: string; variant: 'accent' | 'muted' } {
		// A computed value names its calculation, not the channel its save came in on.
		const label =
			computedOrigin(rec) ?? classificationLabel(rec.origin.classification, rec.origin.source_system);
		return { label, variant: rec.origin.classification === 'sync' ? 'accent' : 'muted' };
	}
</script>

{#snippet field(label: string, value: string, tip: string | undefined, numeric: boolean)}
	<div class="flex min-w-0 flex-col" title={tip}>
		<dt class="text-xs text-brand-muted">{label}</dt>
		<dd class="text-brand-text {numeric ? 'font-mono tabular-nums' : ''}">{value}</dd>
	</div>
{/snippet}

{#snippet calibrationCell(r: ProvenanceReading, sensorId: string | undefined)}
	{#if r.calibration}
		{#if sensorId}
			<a
				class="text-brand-primary hover:underline"
				href="{base}/sensors/{sensorId}?tab=calibrations&cal={r.calibration.id}"
				title="Open this calibration on the instrument"
				>{formatEquation(r.calibration.slope, r.calibration.intercept)}</a
			>
		{:else}
			<span>{formatEquation(r.calibration.slope, r.calibration.intercept)}</span>
		{/if}
		<span class="text-xs text-brand-muted">{calibrationWindow(r.calibration)}</span>
		{#if r.calibration.retired_at}
			<span class="text-xs text-brand-muted" title="This curve was retired. The value it produced stands; no new measurement resolves it.">Retired {formatDateTime(r.calibration.retired_at)}</span>
		{/if}
	{:else}
		{NO_VALUE}
	{/if}
{/snippet}

{#snippet curveCell(r: ProvenanceReading)}
	{#if r.standard_curve}
		<a
			class="text-brand-primary hover:underline"
			href="{base}/sensors/{r.standard_curve.sensor_id}?tab=curves&curve={r.standard_curve.id}"
			title="Open this standard curve on the lab instrument"
			>{curveLabel({ id: r.standard_curve.id, name: r.standard_curve.name ?? null })}</a
		>
		<span class="text-xs text-brand-muted">{formatEquation(r.standard_curve.slope, r.standard_curve.intercept)}</span>
		{#if r.standard_curve.retired_at}
			<span class="text-xs text-brand-muted" title="The lab retired this curve. The value it produced stands; it is no longer offered for a new measurement.">Retired {formatDateTime(r.standard_curve.retired_at)}</span>
		{/if}
	{:else}
		{NO_VALUE}
	{/if}
{/snippet}

{#snippet optional(label: string, value: string, tip: string | undefined, numeric: boolean)}
	{#if value !== NO_VALUE}{@render field(label, value, tip, numeric)}{/if}
{/snippet}

{#snippet inlineField(label: string, value: string, tip: string | undefined, numeric: boolean)}
	<div class="flex min-w-0 flex-col" title={tip}>
		<span class="text-xs text-brand-muted">{label}</span>
		<span class="text-brand-text {numeric ? 'font-mono tabular-nums' : ''}">{value}</span>
	</div>
{/snippet}

{#snippet inlineOptional(label: string, value: string, tip: string | undefined, numeric: boolean)}
	{#if value !== NO_VALUE}{@render inlineField(label, value, tip, numeric)}{/if}
{/snippet}

{#snippet statistics(rec: ProvenanceRecord)}
	{@const c = rec.computation}
	{#if c && typeof c.n === 'number'}
		<div class={lineClass}>
			{@render inlineField('Replicates', formatCount(c.n), undefined, true)}
			{@render inlineOptional(`Mean${unitSuffix}`, fmt(c.mean), undefined, true)}
			{@render inlineOptional('Standard deviation', fmt(c.stdev), 'The sample standard deviation (n-1)', true)}
			{@render inlineOptional('Minimum', fmt(c.min), undefined, true)}
			{@render inlineOptional('Maximum', fmt(c.max), undefined, true)}
			{#each stateCounts(rec) as st (st.label)}
				<Badge variant={st.label === 'withdrawn' ? 'muted' : 'warning'}>{formatCount(st.n)} {st.label}</Badge>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet calculation(rec: ProvenanceRecord)}
	{@const author = rec.computation?.created_by ?? NO_VALUE}
	{@const what = computationText(rec)}
	{@const label = rec.computation?.label || NO_VALUE}
	{@const notes = rec.computation?.notes || NO_VALUE}
	{@const retired = recordDecommission(rec)}
	{#if what !== NO_VALUE || author !== NO_VALUE || label !== NO_VALUE || notes !== NO_VALUE}
		<div class={lineClass}>
			{#if rec.calculation}
				<div class="flex min-w-0 flex-col" title={computationTip(rec)}>
					<span class="text-xs text-brand-muted">Computation</span>
					<a class="text-brand-primary hover:underline" href={calculationHref(base, rec.calculation, computationAnchor(rec))}>{what}</a>
				</div>
			{:else}
				{@render inlineOptional('Computation', what, computationTip(rec), false)}
			{/if}
			{@render inlineOptional('Run by', author, undefined, false)}
			{@render inlineOptional('Label', label, 'The label named when the value was saved', false)}
			{@render inlineOptional('Notes', notes, 'The notes entered when the value was saved', false)}
		</div>
		{#if retired}
			<p class="col-span-full text-xs text-brand-accent-dark">{decommissionText(retired)}</p>
		{/if}
	{/if}
{/snippet}

{#snippet portalCalculation(rec: ProvenanceRecord)}
	{@const calc = rec.origin.portal_calculation}
	{#if calc}
		<div class={lineClass}>
			<div class="flex min-w-0 flex-col" title="The portal function that computed this column, as the source declared it.">
				<span class="text-xs text-brand-muted">Portal calculation</span>
				<span class="text-brand-text">
					<span class="font-mono">{calc.function}</span>
					<span class="text-xs text-brand-muted">of</span>
					{#each calc.inputs as input, i (input.column)}
						{#if i > 0}<span class="text-brand-muted">, </span>{/if}
						{#if input.point}
							<a class="font-mono text-brand-primary hover:underline" href={slotHref(base, input.point)} title="Open the record of this column at the instant">{input.column}</a>
						{:else}
							<span class="font-mono">{input.column}</span>
						{/if}
					{/each}
				</span>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet instrument(rec: ProvenanceRecord)}
	{@const r = sharedApplied(rec)}
	{@const named = instrumentText(rec)}
	{#if named !== NO_VALUE || r?.calibration || r?.standard_curve}
		<div class={lineClass}>
			{@render inlineOptional('Instrument', named, undefined, false)}
			{#if r?.calibration}
				<div class="flex min-w-0 flex-col" title="The windowed calibration applied to the measurement.">
					<span class="text-xs text-brand-muted">Calibration</span>
					<span class="text-brand-text">{@render calibrationCell(r, rec.chain.sensor?.id)}</span>
				</div>
			{/if}
			{#if r?.standard_curve}
				<div class="flex min-w-0 flex-col" title="The lab curve chosen for this measurement.">
					<span class="text-xs text-brand-muted">Standard curve</span>
					<span class="text-brand-text">{@render curveCell(r)}</span>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet consumedInput(c: ConsumedInput)}
	{@const single = c.members?.length === 1 ? c.members[0] : null}
	{@const href = single ? memberHref(base, single) : null}
	<tr class="border-t border-brand-divider/60">
		<td class="py-0.5 pr-3 align-top">
			{#if href}
				<a class="text-brand-primary hover:underline" href={href} title="Open the record of the reading this was read from">{c.variable}</a>
			{:else}
				<span class="text-brand-text">{c.variable}</span>
			{/if}
			<span class="ml-1 text-xs text-brand-muted">{kindLabel(c.kind)}</span>
			{#if c.property}<span class="ml-1 text-xs text-brand-muted">{c.property}</span>{/if}
		</td>
		<td class="py-0.5 pr-3 {numericCell}">{consumedText(c.value)}</td>
		<td class="py-0.5 pr-3 {numericCell}">
			{c.current_value === null || c.current_value === undefined ? NO_VALUE : consumedText(c.current_value)}
		</td>
		<td class="py-0.5" title={markTip(c.state)}>
			<Badge variant={markVariant(c.state)}>{c.state}</Badge>
		</td>
	</tr>
	{#if (c.members?.length ?? 0) > 1}
		<tr>
			<td colspan="4" class="pb-1 pl-3 text-xs text-brand-muted">
				{#each c.members ?? [] as m (m.stream_id + m.replicate_index)}
					{@const mHref = memberHref(base, m)}
					<span class="mr-3 inline-flex items-baseline gap-1">
						{#if mHref}
							<a class="text-brand-primary hover:underline" href={mHref}>#{m.replicate_index}</a>
						{:else}
							<span>#{m.replicate_index}</span>
						{/if}
						<span class="font-mono">{m.value ?? NO_VALUE}</span>
						{#if m.state === 'changed'}
							<span class="font-mono" title="What the key holds now">→ {m.current_value ?? NO_VALUE}</span>
						{/if}
					</span>
				{/each}
			</td>
		</tr>
	{/if}
{/snippet}

{#snippet consumed(rec: ProvenanceRecord)}
	{@const set = rec.consumed ?? []}
	{#if set.length > 0}
		<div class="mt-2">
			<div class="flex flex-wrap items-baseline gap-2">
				<p class="text-xs text-brand-muted">Consumed</p>
				{#if anyChanged(set)}
					<Badge variant="warning">a source has moved</Badge>
				{/if}
			</div>
			<table class="mt-1 w-full text-left">
				<thead class="text-xs text-brand-muted">
					<tr>
						<th class="py-0.5 pr-3 font-medium">Input</th>
						<th class="py-0.5 pr-3 text-right font-medium">Read</th>
						<th class="py-0.5 pr-3 text-right font-medium">Now</th>
						<th class="py-0.5 font-medium">State</th>
					</tr>
				</thead>
				<tbody>
					{#each orderedInputs(set) as c (c.variable + c.kind)}
						{@render consumedInput(c)}
					{/each}
				</tbody>
			</table>
			{#if rec.captured_by}
				{@const capture = captureLine(base, rec.captured_by)}
				<p class="mt-1 text-xs text-brand-muted">
					Read by:
					{#if capture.href}
						<a href={capture.href} class="text-brand-primary no-underline hover:underline">{capture.text}</a>
					{:else}
						{capture.text}
					{/if}
				</p>
			{/if}
		</div>
	{:else if computed(rec)}
		<p class="mt-2 text-xs text-brand-muted" title="Nothing recorded what this computation read, so its inputs cannot be named.">
			Consumed inputs unknown: this value was computed before they were recorded.
		</p>
	{/if}
{/snippet}

{#snippet replicateTable(rec: ProvenanceRecord)}
	<table class="mt-1 w-full text-left">
		<thead class="text-xs text-brand-muted">
			<tr>
				<th class="py-0.5 pr-3 font-medium">Replicate</th>
				<th class="py-0.5 pr-3 text-right font-medium">{valueLabel(rec)}{unitSuffix}</th>
				<th class="py-0.5 pr-3 text-right font-medium">Corrected{unitSuffix}</th>
				{#if !sharedApplied(rec)}<th class="py-0.5 pr-3 font-medium">Applied</th>{/if}
				<th class="py-0.5 pr-3 font-medium">State</th>
				<th class="py-0.5 font-medium">Arrived</th>
			</tr>
		</thead>
		<tbody>
			{#each rec.readings as r (r.replicate_index)}
				<tr class="border-t border-brand-divider/60 {r.withdrawn_at ? 'opacity-60' : ''}">
					<td class="py-0.5 pr-3 text-brand-muted">{r.replicate_index}</td>
					<td class="py-0.5 pr-3 {numericCell} {r.withdrawn_at ? 'line-through' : ''}"
						>{fmt(r.raw_value)}</td
					>
					<td class="py-0.5 pr-3 {numericCell} {r.withdrawn_at ? 'line-through' : ''}">
						{fmt(r.calibrated_value)}
					</td>
					{#if !sharedApplied(rec)}
						<td class="py-0.5 pr-3 text-brand-muted">
							{#if r.calibration || r.standard_curve}
								{#if r.calibration}{@render calibrationCell(r, rec.chain.sensor?.id)}{/if}
								{#if r.calibration && r.standard_curve}<span> then </span>{/if}
								{#if r.standard_curve}{@render curveCell(r)}{/if}
							{:else}
								{NO_VALUE}
							{/if}
						</td>
					{/if}
					<td class="py-0.5 pr-3" title={stateTip(r)}>
						{#if r.withdrawn_at}
							<Badge variant="muted">withdrawn</Badge>
							{#if r.withdrawn_reason}<span class="text-xs text-brand-muted">{r.withdrawn_reason}</span>{/if}
						{:else if r.is_flagged}
							<Badge variant="warning">flagged{r.flag_reason ? `: ${r.flag_reason}` : ''}</Badge>
						{:else if r.unverified}
							<Badge variant="warning">pending</Badge>
						{:else}
							<span class="text-brand-muted">{NO_VALUE}</span>
						{/if}
					</td>
					<td class="py-0.5 text-xs text-brand-muted">{arrivedText(r)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<!-- The record is bounded: unfolding its details scrolls inside the panel rather than pushing
     whatever follows the chart off the screen. -->
<div
	data-testid="point-record"
	class="mt-2 flex max-h-[70vh] flex-col rounded-lg border border-brand-divider bg-brand-surface px-3 py-2 text-sm"
>
	<div class="flex shrink-0 items-start justify-between gap-2">
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="font-medium text-brand-text">{parameterName}</span>
			<span class="text-brand-muted">{formatDateTime(timeIso)}</span>
		</div>
		{#if onclose}
			<button
				class="rounded p-1 text-brand-muted hover:bg-brand-bg hover:text-brand-text"
				aria-label="Close"
				onclick={onclose}>✕</button
			>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
	{#if loading}
		<p class="text-brand-muted">Loading…</p>
	{:else if error}
		<ErrorNotice message={error} />
	{:else if resp}
		{#if resp.records.length === 0}
			<p class="mt-2 text-brand-muted">No readings at this instant.</p>
		{/if}
		{#if resp.duplicate_slot}
			<p class="mt-2 rounded bg-severity-warning-soft px-2 py-1 text-xs text-severity-warning-text">
				{resp.records.length} streams serve this slot at this instant. Each record is shown.
			</p>
		{/if}
		{#each resp.takeovers ?? [] as takeover (takeover.at)}
			<p class="mt-2 text-xs text-brand-accent-dark">{takeoverText(resp.parameter_code, takeover)}</p>
		{/each}
		{#each resp.records as rec, i (rec.origin.stream_id)}
			{@const serviceHref = originServiceHref(base, rec.origin, me.can('admin'))}
			<div class="@container {i > 0 ? 'mt-3 border-t border-brand-divider pt-3' : 'mt-2'}">
			<!-- The record, then its history under it at full width, open on arrival. -->
			<div class="space-y-3">
			<div class="min-w-0">
				<div class="flex flex-wrap items-start gap-2">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
					{#if serviceHref}
						<a href={serviceHref} class="inline-flex" title="Open the sync service that wrote it">
							<Badge variant={originBadge(rec).variant}>{originBadge(rec).label}</Badge>
						</a>
					{:else}
						<Badge variant={originBadge(rec).variant}>{originBadge(rec).label}</Badge>
					{/if}
					<Badge variant="muted">{cadence(rec)}</Badge>
					<span class="text-brand-muted" title={rec.origin.source_key}>
						{rec.origin.source_name ?? rec.origin.source_key}
					</span>
					{#if rec.origin.receipt?.braked}<Badge variant="warning">brake fired</Badge>{/if}
					{#each rec.holds as h (h.id)}
						<a href={holdHref(rec, h)} class="inline-flex" title={holdTip(h)}>
							<Badge variant={h.status === 'pending' ? 'warning' : 'muted'}>
								{HOLD_LABEL[h.kind] ?? h.kind} · {h.status}
							</Badge>
						</a>
					{/each}
				</div>
					<div
						role="group"
						aria-label="Actions"
						class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
					>
						{#if onflag && rec.readings.length > 0 && flaggable(rec)}
							<button
								class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
								onclick={() => onflag(replicatesOf(rec))}>Flag replicates</button
							>
						{/if}
						{#if rec.event}
							<a
								class="text-brand-primary hover:underline"
								href="{base}{visitHref(siteId, rec.event.id, parameterId)}"
								title="Visit of {formatDateTime(rec.event.collected_at)}, {rec.event.source === 'portal_sync'
									? `synced from the portal${rec.event.created_by ? ` by ${rec.event.created_by}` : ''}`
									: originPhrase('entry', { actor: rec.event.created_by ?? undefined })}."
								>Open visit</a
							>
						{/if}
						{#if rec.chain.sensor}
							<a
								class="text-brand-primary hover:underline"
								href="{base}/sensors/{rec.chain.sensor.id}"
								title={instrumentText(rec)}>Open instrument</a
							>
						{/if}
						<a
							class="text-brand-primary hover:underline"
							href="{base}/streams?q={encodeURIComponent(rec.origin.source_key)}"
							title="{rec.origin.source_system} · {rec.origin.source_key}">Open stream</a
						>
						{#if link && i === 0}
							<button
								class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
								title={link}
								onclick={copyLink}>Copy link</button
							>
						{/if}
						<button
							class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
							title="What produced it decides what may be done to it"
							onclick={() => openEdit(rec)}>Edit</button
						>
						{#if overridable(rec)}
							<button
								class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
								title="Replace the calculated value by hand; the calculation stops writing it here"
								onclick={() => openEdit(rec, 'override')}>Override</button
							>
						{/if}
					</div>
				</div>

				<div class={factsClass}>
				{@render portalCalculation(rec)}
				{#if cadence(rec) === 'derived'}{@render calculation(rec)}{/if}
				{#if rec.readings.length === 1}
					{@const r = rec.readings[0]}
					<dl class="contents">
						{@render field(`${valueLabel(rec)}${unitSuffix}`, fmt(r.raw_value), undefined, true)}
						{@render optional(`Corrected${unitSuffix}`, fmt(r.calibrated_value), undefined, true)}
						{@render optional('State', stateText(r), stateTip(r), false)}
					</dl>
				{:else}
					{@render statistics(rec)}
				{/if}
				<dl class="contents">
					{#if rec.readings[0]}
						{@render optional('Origin', originText(rec.readings[0]), 'The write path that produced it', false)}
					{/if}
					{@render optional('Stream', `${rec.origin.source_system} · ${rec.origin.source_key}`, undefined, false)}
				</dl>
				{#each rec.readings.filter((r) => r.overridden) as r (r.replicate_index)}
					<p class="col-span-full text-xs" data-testid="overridden">
						<Badge variant="warning">overridden</Badge>
						<span class="ml-1 text-brand-text">{overrideText(r)}</span>
					</p>
				{/each}
				{@render instrument(rec)}
				{#if cadence(rec) !== 'derived'}{@render calculation(rec)}{/if}
				</div>
				{@render consumed(rec)}

				<details class="mt-2">
					<summary class="w-fit cursor-pointer text-xs text-brand-muted">Details</summary>
					{#if rec.readings.length > 1}{@render replicateTable(rec)}{/if}
					<div class="mt-2 flex flex-wrap items-center gap-x-3 text-xs">
						{#if rec.computation?.provenance}
							<button
								class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
								onclick={() => toggleToolRun(i)}
								>{showToolRun.has(i) ? 'Hide tool run' : 'Show tool run'}</button
							>
						{/if}
						{#if rec.calculation && !replays[i]}
							<button
								class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
								onclick={() => showReplay(i, rec)}
								>Show the arithmetic</button
							>
						{/if}
					</div>
				{#if replays[i]}
					<!-- The formula the computation recorded, run again over the values it recorded.
					     A replayed number that is not the stored one means the row moved outside
					     the ledger, which is what this read is for. -->
					<div class="mt-2 text-xs">
						{#if 'error' in replays[i]}
							<p class="text-brand-muted">{replays[i].error}</p>
						{:else}
							{@const r = replays[i] as ReplayResult}
							<p class="font-mono">{r.formula}</p>
							<p class="text-brand-muted">
								{Object.entries(r.variables)
									.map(([name, value]) => `${name} = ${value}`)
									.join(', ')}
							</p>
							<p>
								= {r.replayed}{r.stored !== null && r.stored !== r.replayed
									? `, and ${r.stored} is stored`
									: ''}
							</p>
						{/if}
					</div>
				{/if}
				{#if rec.computation?.provenance && showToolRun.has(i)}
					<div class="mt-2">
						<ProvenanceCard
							provenance={rec.computation.provenance}
							decommissioned={rec.computation.decommissioned}
							parameterCode={resp.parameter_code}
							consumed={rec.consumed}
						/>
					</div>
				{/if}
				</details>
			</div>
			{@render historyPanel(i, rec)}
			</div>
			</div>
		{/each}
	{/if}
	</div>
</div>

{#snippet historyPanel(i: number, rec: ProvenanceRecord)}
	{@const rows = historyRows(history[i] ?? [])}
	<section class="min-w-0 text-xs" aria-label="History">
		<div class="mb-1 flex items-center gap-2 text-brand-muted">
			<span class="font-medium text-brand-text">History</span>
			{#each [['all', 'Everything'], ['warning', 'Warnings'], ['error', 'Failures']] as [level, label] (level)}
				<button
					class="cursor-pointer border-none bg-transparent p-0 hover:underline"
					class:font-medium={severity === level}
					class:text-brand-primary={severity === level}
					onclick={() => filterBy(level as 'all' | 'error' | 'warning')}>{label}</button
				>
			{/each}
		</div>
		{#if historyError[i]}
			<ErrorNotice message={historyError[i]} />
		{:else if !history[i]}
			<p class="text-brand-muted">Loading…</p>
		{:else if rows.length === 0}
			<p class="text-brand-muted">Nothing has happened to this reading: it stands as it arrived.</p>
		{:else}
			{@render timeAxis(rows)}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse">
					<thead>
						<tr class="text-left text-brand-muted">
							<th class="py-0.5 pr-2 font-normal">Date</th>
							<th class="py-0.5 pr-2 font-normal">What</th>
							<th class="py-0.5 pr-2 font-normal">Change</th>
							<th class="py-0.5 pr-2 font-normal">Reason</th>
							<th class="py-0.5 pr-2 font-normal">Who</th>
							<th class="py-0.5 pr-2 font-normal">Open</th>
							<th class="py-0.5 font-normal" aria-label="Roll back"></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.key)}
							{@render historyRow(i, rec, row)}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{/snippet}

{#snippet timeAxis(rows: HistoryRow[])}
	{@const times = rows.map((r) => Date.parse(r.at))}
	{@const first = Math.min(...times)}
	{@const span = Math.max(...times) - first}
	<!-- One mark per row, so a change reads as a point in time. -->
	<div class="mb-2" data-testid="history-axis">
		<div class="relative h-3 border-b border-brand-divider">
			{#each rows as row (row.key)}
				<span
					class="absolute bottom-0 h-3 w-0.5 -translate-x-1/2 {row.severity === 'error'
						? 'bg-severity-alarm'
						: row.severity === 'warning'
							? 'bg-severity-warning'
							: row.decision
								? 'bg-brand-primary'
								: 'bg-brand-muted'}"
					style="left: {span > 0 ? ((Date.parse(row.at) - first) / span) * 100 : 50}%"
					title="{row.what}, {formatDateTime(row.at)}"
				></span>
			{/each}
		</div>
		<div class="flex justify-between text-[11px] text-brand-muted">
			<span>{formatDateTime(new Date(first).toISOString())}</span>
			{#if span > 0}<span>{formatDateTime(new Date(first + span).toISOString())}</span>{/if}
		</div>
	</div>
{/snippet}

{#snippet historyRow(i: number, rec: ProvenanceRecord, row: HistoryRow)}
	{@const decision = row.decision}
	{@const href = entryHref(rec, row.entry)}
	{@const ruling = decision ? rulingHold(decision.head) : null}
	<tr class="border-t border-brand-divider align-top">
		<td class="py-1 pr-2 whitespace-nowrap text-brand-muted tabular-nums" title={formatDateTime(row.at)}
			>{formatCompactInstant(row.at, timezoneStore.zone).slice(0, 16)}</td
		>
		<td class="py-1 pr-2">
			<span class="font-medium">{row.what}</span>
			{#if decision && decision.members.length > 1}
				<span class="text-brand-muted" title={memberRows(decision)}
					>, {formatCount(decision.members.length)} readings</span
				>
			{/if}
			{#if row.severity !== 'info'}
				<Badge variant={row.severity === 'error' ? 'alarm' : 'warning'}>{row.severity}</Badge>
			{/if}
		</td>
		<td class="py-1 pr-2 text-brand-muted">
			{#each row.changes as c (c.field)}
				<span class="block" title="{fieldLabel(c.field)} {rawText(c.from)} → {rawText(c.to)}"
					>{fieldLabel(c.field)} {cellText(c.from)} → {cellText(c.to)}</span
				>
			{/each}
		</td>
		<td class="py-1 pr-2 text-brand-muted">{row.reason ?? ''}</td>
		<td class="py-1 pr-2 text-brand-muted">
			{row.who ?? ''}{row.who ? ' · ' : ''}{row.origin}
		</td>
		<td class="py-1 pr-2">
			{#if href}
				<a
					class="inline-block rounded border border-brand-divider px-1.5 py-0.5 text-brand-primary hover:border-brand-primary hover:bg-brand-primary/5"
					{href}
					title={openTitle(row.entry)}>Open</a
				>
			{/if}
		</td>
		<td class="py-1">
			<div class="flex flex-col items-start gap-0.5">
			{#if decision?.head.rolled_back_by}
				<span class="text-brand-muted">rolled back</span>
			{:else if decision && ruling}
				{#if me.can('manageSensors')}
					<Button
						size="sm"
						variant="ghost"
						disabled={rollingBack === decision.head.id}
						title="Rolls back the ruling and returns its hold to the review queue"
						onclick={() => reopenRuling(i, rec, decision, ruling)}>Reopen ruling</Button
					>
				{:else}
					<span class="text-brand-muted">a manager's ruling, undone by reopening it</span>
				{/if}
			{:else if decision && undoable(decision.head)}
				<Button
					size="sm"
					variant="ghost"
					disabled={rollingBack === decision.head.id}
					aria-label="Roll back this reading"
					title="Roll back this reading: puts back its values from before this decision"
					onclick={() => askRollback(i, rec, decision)}>Roll back</Button
				>
			{/if}
			</div>
		</td>
	</tr>
{/snippet}

{#if recovery}
	<RollbackDialog
		bind:open={recoveryOpen}
		title="Roll back this reading"
		lines={recovery.lines}
		loading={recovery.loading}
		busy={rollingBack === recovery.entry.head.id}
		error={recovery.error}
		onconfirm={rollBack}
	/>
{/if}

{#if editSelection}
	<EditReadingDialog
		bind:open={editOpen}
		selection={editSelection}
		title="Edit {parameterName}"
		initial={editInitial}
		onsuccess={() => void changed()}
	/>
{/if}
