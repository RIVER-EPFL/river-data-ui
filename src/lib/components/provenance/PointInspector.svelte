<script lang="ts">
	import { base } from '$app/paths';
	import {
		getReadingProvenance,
		type ProvenanceResponse,
		type ProvenanceRecord,
		type ProvenanceReading,
		type ProvenanceCalibrationRef,
		type ProvenanceCalculation,
		type ReceiptSummary,
		getReadingDecisions,
		getReadingLedger,
		rollbackEdit,
		rollbackEditSet,
		type LedgerEntry,
		type ReadingDecision,
	} from '$api/service';
	import type { SampleReplicate } from '$api/types';
	import { replicatesOf } from '$lib/provenance/replicates';
	import { curveLabel, formatEquation } from '$lib/standardCurves';
	import { classificationLabel, originPhrase, provenanceKindLabel } from '$lib/origin';
	import { NO_VALUE, formatCount, formatMeasurement, numericCell } from '$lib/format';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ProvenanceCard from '$components/samples/ProvenanceCard.svelte';
	import EditReadingDialog from '$components/dialogs/EditReadingDialog.svelte';
	import {
		changedFields,
		decisionLabel,
		fieldLabel,
		timelineEntries,
		undoable,
		type DecisionEntry,
	} from '$lib/provenance/decisions';
	import { ledgerLine, ledgerWeight } from '$lib/provenance/ledger';

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
	// The history of one record, fetched on demand: it is the audit trail, not part of the value,
	// so it is not on the critical path of reading the record. The ledger is the timeline; the
	// decisions read beside it is what says which of its entries an operator may still undo.
	let showHistory = $state<Set<number>>(new Set());
	let history = $state<Record<number, LedgerEntry[]>>({});
	let decisions = $state<Record<number, ReadingDecision[]>>({});
	let historyError = $state<Record<number, string>>({});
	let severity = $state<'all' | 'error' | 'warning'>('all');
	// The administrative half of a history, folded to its newest few until a reader asks for it.
	let showAllAdmin = $state<Set<number>>(new Set());
	let rollingBack = $state<string | null>(null);
	let editOpen = $state(false);
	let editSelection = $state<{ keys: { stream_id: string; time: string }[] } | null>(null);

	// How many administrative entries a folded history shows before the rest are behind the count.
	const ADMIN_SHOWN = 3;

	function valueEntries(i: number): LedgerEntry[] {
		return (history[i] ?? []).filter((e) => ledgerWeight(e) === 'value');
	}

	function adminEntries(i: number): LedgerEntry[] {
		return (history[i] ?? []).filter((e) => ledgerWeight(e) === 'administrative');
	}

	function shownAdmin(i: number): LedgerEntry[] {
		const all = adminEntries(i);
		return showAllAdmin.has(i) ? all : all.slice(0, ADMIN_SHOWN);
	}

	function toggleAdmin(i: number) {
		const next = new Set(showAllAdmin);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		showAllAdmin = next;
	}

	async function toggleHistory(i: number, rec: ProvenanceRecord) {
		const next = new Set(showHistory);
		if (next.has(i)) {
			next.delete(i);
			showHistory = next;
			return;
		}
		next.add(i);
		showHistory = next;
		await loadHistory(i, rec);
	}

	// The severity is the one filter, and the endpoint applies it, so changing it re-reads every
	// record already open rather than hiding rows it already holds.
	async function filterBy(level: 'all' | 'error' | 'warning') {
		severity = level;
		for (const i of showHistory) {
			const rec = resp?.records[i];
			if (rec) await loadHistory(i, rec);
		}
	}

	/** The decision behind a ledger entry, where the entry is one: only that arm can be undone. */
	function decisionFor(i: number, entry: LedgerEntry): DecisionEntry | undefined {
		if (entry.source !== 'decision') return undefined;
		return timelineEntries(decisions[i] ?? []).find((e) => e.head.id === entry.id);
	}

	/** Where an entry lives, for the records that have a page of their own. */
	function entryHref(rec: ProvenanceRecord, entry: LedgerEntry): string | null {
		switch (entry.source) {
			// A timeline line is keyed by its job, so both arms open the same run with its log.
			case 'job':
			case 'job_log':
				return `${base}/system?tab=jobs&job=${entry.id}`;
			case 'hold': {
				// The record knows this hold's status where it still holds it, and the queue view
				// follows from the status.
				const held = rec.holds.find((h) => h.id === entry.id);
				return held ? holdHref(rec, held) : `${base}/streams?tab=audits&holds_id=${entry.id}`;
			}
			case 'ingest':
				return `${base}/streams?q=${encodeURIComponent(rec.origin.source_key)}`;
			case 'alarm':
				return `${base}/alarms`;
			default:
				return null;
		}
	}

	function cellText(v: unknown): string {
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
			decisions = {
				...decisions,
				[i]: await getReadingDecisions({ stream_id: rec.origin.stream_id, time: timeIso }),
			};
			historyError = { ...historyError, [i]: '' };
		} catch (e) {
			historyError = {
				...historyError,
				[i]: e instanceof Error ? e.message : String(e),
			};
		}
	}

	// A set was one act, so it is undone as one: the set endpoint inverts every live decision it
	// recorded, which is what the per-decision endpoint cannot do for its siblings.
	async function rollBack(i: number, rec: ProvenanceRecord, e: DecisionEntry) {
		const d = e.head;
		rollingBack = d.id;
		try {
			if (e.set_id && e.members.length > 1) {
				await rollbackEditSet(e.set_id);
			} else {
				await rollbackEdit(d.id);
			}
			toastStore.success(`${decisionLabel(d.kind)} rolled back`);
			await loadHistory(i, rec);
			await changed();
		} catch (e) {
			historyError = {
				...historyError,
				[i]: e instanceof Error ? e.message : String(e),
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

	function openEdit(rec: ProvenanceRecord) {
		editSelection = { keys: [{ stream_id: rec.origin.stream_id, time: timeIso }] };
		editOpen = true;
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

	const ESTIMATOR_TIP: Record<string, string> = {
		default: 'Not declared for this parameter, so the sample formula applies by default.',
		sample: 'Chosen for this collection group.',
		slot: 'Declared for this parameter.',
		stream: 'Declared by the source.',
		tool: 'Fixed by the tool that computed it.',
	};

	function fmt(v: number | null | undefined): string {
		return formatMeasurement(v, decimals);
	}

	const unitSuffix = $derived(units ? ` (${units})` : '');
	const gridClass =
		'mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]';

	function cadence(rec: ProvenanceRecord): string {
		return rec.readings[0]?.measurement_type ?? 'continuous';
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
	function recordArrivedText(rec: ProvenanceRecord): string {
		const at = rec.origin.value_arrived_at ?? rec.origin.ingested_at;
		return at ? formatDateTime(at) : NO_VALUE;
	}

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

	function receiptText(rc: ReceiptSummary): string {
		const counts = [
			`${formatCount(rc.submitted)} submitted`,
			`${formatCount(rc.new_rows)} new`,
			`${formatCount(rc.changed)} changed`,
			`${formatCount(rc.unchanged)} unchanged`,
			`${formatCount(rc.withdrawn)} withdrawn`,
			`${formatCount(rc.rejected_total)} rejected`,
		].join(', ');
		const window =
			rc.window_from && rc.window_to
				? `; window ${formatDateTime(rc.window_from)} to ${formatDateTime(rc.window_to)}`
				: '';
		return `${formatDateTime(rc.at)}: ${counts}${window}`;
	}

	function estimatorText(rec: ProvenanceRecord): string {
		const est = rec.computation?.sd_estimator;
		if (!est) return NO_VALUE;
		return est === 'population' ? 'population (n)' : 'sample (n-1)';
	}

	function estimatorTip(rec: ProvenanceRecord): string {
		const src = rec.computation?.sd_estimator_source;
		if (!rec.computation?.sd_estimator) return 'No standard deviation is served for this instant.';
		return ESTIMATOR_TIP[src ?? 'default'] ?? '';
	}

	// The served standard deviation is a number; which divisor made it, and what chose that, is the
	// tip behind it.
	function sdTip(rec: ProvenanceRecord): string {
		const est = estimatorText(rec);
		const why = estimatorTip(rec);
		return est === NO_VALUE ? why : `${est}: ${why}`;
	}

	function computationText(rec: ProvenanceRecord): string {
		if (rec.calculation) return calculationText(rec.calculation);
		if (!rec.computation?.provenance) return NO_VALUE;
		const src = rec.computation.run_source;
		if (src === 'chain') return 'recomputed by chain';
		if (src && src !== 'interactive') return src;
		return 'tool run';
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

	function holdTip(h: ProvenanceRecord['holds'][number]): string {
		return `Raised ${formatDateTime(h.created_at)}. Opens the review queue on this hold.`;
	}

	// The queue narrowed to this one hold. Statistics holds are keyed by stream, so the stream
	// chip travels too; slot-keyed findings carry no stream. Deferred and decided holds live in
	// their own views.
	function holdHref(rec: ProvenanceRecord, h: ProvenanceRecord['holds'][number]): string {
		const params = new URLSearchParams({ tab: 'audits', holds_id: h.id });
		if (h.kind === 'replicate_stats') params.set('holds_streams', rec.origin.stream_id);
		if (h.status === 'deferred') params.set('view', 'deferred');
		else if (h.status !== 'pending') params.set('view', 'resolved');
		return `${base}/streams?${params}`;
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
	}

	$effect(() => {
		const key = `${siteId}|${parameterId}|${timeIso}|${measurementType ?? ''}|${revision}`;
		void key;
		showToolRun = new Set();
		showHistory = new Set();
		error = '';
		ownRecord = false;
		void load();
	});

	function toggleToolRun(i: number) {
		const next = new Set(showToolRun);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		showToolRun = next;
	}

	function originBadge(rec: ProvenanceRecord): { label: string; variant: 'accent' | 'muted' } {
		const label = classificationLabel(rec.origin.classification, rec.origin.source_system);
		return { label, variant: rec.origin.classification === 'sync' ? 'accent' : 'muted' };
	}
</script>

{#snippet field(label: string, value: string, tip: string | undefined, numeric: boolean)}
	<div class="contents" title={tip}>
		<dt class="py-0.5 text-xs text-brand-muted">{label}</dt>
		<dd
			class="py-0.5 text-brand-text {numeric ? 'text-right font-mono tabular-nums' : ''}"
		>{value}</dd>
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

{#snippet statistics(rec: ProvenanceRecord)}
	{@const c = rec.computation}
	{#if c && typeof c.n === 'number'}
		<dl class={gridClass}>
			{@render field('Replicates', formatCount(c.n), 'How many replicates these statistics count.', true)}
			{@render optional(`Mean${unitSuffix}`, fmt(c.mean), undefined, true)}
			{@render optional('Standard deviation', fmt(c.stdev), sdTip(rec), true)}
			{@render optional('Minimum', fmt(c.min), undefined, true)}
			{@render optional('Maximum', fmt(c.max), undefined, true)}
		</dl>
	{/if}
{/snippet}

{#snippet calculation(rec: ProvenanceRecord)}
	{@const author = rec.computation?.created_by ?? NO_VALUE}
	{@const what = computationText(rec)}
	{#if what !== NO_VALUE || author !== NO_VALUE}
		<dl class={gridClass}>
			{@render optional('Computation', what, computationTip(rec), false)}
			{@render optional('Entered by', author, undefined, false)}
		</dl>
	{/if}
{/snippet}

{#snippet instrument(rec: ProvenanceRecord)}
	{@const r = rec.readings.length === 1 ? rec.readings[0] : undefined}
	{@const named = instrumentText(rec)}
	{#if named !== NO_VALUE || r?.calibration || r?.standard_curve}
		<dl class={gridClass}>
			{@render optional('Instrument', named, 'The instrument and deployment attributed to this measurement.', false)}
			{#if r?.calibration}
				<div class="contents" title="The windowed calibration applied to the measurement.">
					<dt class="py-0.5 text-xs text-brand-muted">Calibration</dt>
					<dd class="py-0.5 text-brand-text">{@render calibrationCell(r, rec.chain.sensor?.id)}</dd>
				</div>
			{/if}
			{#if r?.standard_curve}
				<div class="contents" title="The lab curve chosen for this measurement.">
					<dt class="py-0.5 text-xs text-brand-muted">Standard curve</dt>
					<dd class="py-0.5 text-brand-text">{@render curveCell(r)}</dd>
				</div>
			{/if}
		</dl>
	{/if}
{/snippet}

{#snippet administrative(rec: ProvenanceRecord)}
	<details class="mt-2">
		<summary class="cursor-pointer text-xs text-brand-muted">Administrative</summary>
		<dl class={gridClass}>
			{@render optional('Arrived', recordArrivedText(rec), 'When the value on display reached the store.', false)}
			{@render optional('Paired', rec.origin.paired_at ? formatDateTime(rec.origin.paired_at) : NO_VALUE, 'When this stream was paired to the slot.', false)}
			{#if rec.readings[0]}
				{@render optional('Origin', originText(rec.readings[0]), 'Which write path produced this value.', false)}
			{/if}
			{@render optional('Stream', `${rec.origin.source_system} · ${rec.origin.source_key}`, undefined, false)}
			{#if rec.origin.receipt}
				{@render field('Reconciliation', receiptText(rec.origin.receipt), 'The latest windowed pass whose claimed window covers this instant.', false)}
			{/if}
		</dl>
	</details>
{/snippet}

<div class="mt-2 rounded-lg border border-brand-divider bg-brand-surface px-3 py-2 text-sm">
	<div class="flex items-start justify-between gap-2">
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
		{#each resp.records as rec, i (rec.origin.stream_id)}
			<div class={i > 0 ? 'mt-3 border-t border-brand-divider pt-3' : 'mt-2'}>
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
					<Badge variant={originBadge(rec).variant}>{originBadge(rec).label}</Badge>
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

				{#if rec.readings.length === 1}
					{@const r = rec.readings[0]}
					<dl class={gridClass}>
						{@render field(`Measured${unitSuffix}`, fmt(r.raw_value), undefined, true)}
						{@render optional(`Corrected${unitSuffix}`, fmt(r.calibrated_value), undefined, true)}
						{@render optional('State', stateText(r), stateTip(r), false)}
					</dl>
				{:else}
					<table class="mt-1 w-full text-left">
						<thead class="text-xs text-brand-muted">
							<tr>
								<th class="py-0.5 pr-3 font-medium">Replicate</th>
								<th class="py-0.5 pr-3 text-right font-medium">Measured{unitSuffix}</th>
								<th class="py-0.5 pr-3 text-right font-medium">Corrected{unitSuffix}</th>
								<th class="py-0.5 pr-3 font-medium">Applied</th>
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
									<td class="py-0.5 pr-3 text-brand-muted">
										{#if r.calibration || r.standard_curve}
											{#if r.calibration}{@render calibrationCell(r, rec.chain.sensor?.id)}{/if}
											{#if r.calibration && r.standard_curve}<span> then </span>{/if}
											{#if r.standard_curve}{@render curveCell(r)}{/if}
										{:else}
											{NO_VALUE}
										{/if}
									</td>
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
					{@render statistics(rec)}
				{/if}
				{@render calculation(rec)}
				{@render instrument(rec)}
				{@render administrative(rec)}

				<div
					role="group"
					aria-label="Actions"
					class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
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
							href="{base}/sites/{siteId}?tab=visits&event={rec.event.id}"
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
					{#if rec.computation?.provenance}
						<button
							class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
							onclick={() => toggleToolRun(i)}
							>{showToolRun.has(i) ? 'Hide tool run' : 'Show tool run'}</button
						>
					{/if}
					{#if link && i === 0}
						<button
							class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
							title={link}
							onclick={copyLink}>Copy link</button
						>
					{/if}
					<button
						class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
						title="What produced this value decides what may be done to it."
						onclick={() => openEdit(rec)}>Edit</button
					>
					<button
						class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
						onclick={() => toggleHistory(i, rec)}
						>{showHistory.has(i) ? 'Hide history' : 'Show history'}</button
					>
				</div>
				{#if showHistory.has(i)}
					<div class="mt-2 text-xs">
						<div class="mb-1 flex items-center gap-2 text-gray-500">
							<span>History</span>
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
						{:else if (history[i] ?? []).length === 0}
							<p class="text-gray-500">
								Nothing has happened to this reading: it stands as it arrived.
							</p>
						{:else}
							<ul class="space-y-1">
								{#each valueEntries(i) as entry (entry.source + entry.id + entry.at)}
									{@render line(i, rec, entry, false)}
								{/each}
							</ul>
							{#if adminEntries(i).length > 0}
								<div class="mt-2 border-t border-gray-200 pt-1">
									{#if adminEntries(i).length > ADMIN_SHOWN}
										<button
											class="cursor-pointer border-none bg-transparent p-0 text-gray-500 hover:underline"
											onclick={() => toggleAdmin(i)}
											>Administrative ({formatCount(adminEntries(i).length)}), {showAllAdmin.has(i)
												? 'show fewer'
												: 'show all'}</button
										>
									{:else}
										<span class="text-gray-500">Administrative</span>
									{/if}
									<ul class="mt-1 space-y-1 text-gray-500">
										{#each shownAdmin(i) as entry (entry.source + entry.id + entry.at)}
											{@render line(i, rec, entry, true)}
										{/each}
									</ul>
								</div>
							{/if}
						{/if}
					</div>
				{/if}
				{#if rec.computation?.provenance && showToolRun.has(i)}
					<div class="mt-2">
						<ProvenanceCard provenance={rec.computation.provenance} />
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

{#snippet line(i: number, rec: ProvenanceRecord, entry: LedgerEntry, muted: boolean)}
	{@const decision = decisionFor(i, entry)}
	{@const href = entryHref(rec, entry)}
	<li class="flex flex-wrap items-baseline gap-x-2">
		<span class:font-medium={!muted}>
			{decision ? decisionLabel(decision.head.kind) : ledgerLine(entry).text}
		</span>
		{#if decision && decision.members.length > 1}
			<span class="text-gray-500" title={memberRows(decision)}
				>{formatCount(decision.members.length)} readings</span
			>
		{/if}
		{#if entry.severity !== 'info'}
			<Badge variant={entry.severity === 'error' ? 'alarm' : 'warning'}>{entry.severity}</Badge>
		{/if}
		<span class="text-gray-500">
			{formatDateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ''}
		</span>
		{#each decision ? changedFields(decision.head) : [] as c (c.field)}
			<span class="text-gray-500">
				{fieldLabel(c.field)}
				{cellText(c.from)} → {cellText(c.to)}
			</span>
		{/each}
		{#if decision?.head.reason}
			<span class="text-gray-500">“{decision.head.reason}”</span>
		{/if}
		{#if href}
			<a class="text-brand-primary hover:underline" {href}>Open</a>
		{/if}
		{#if decision?.head.rolled_back_by}
			<span class="text-gray-400">rolled back</span>
		{:else if decision && undoable(decision.head)}
			<button
				class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline disabled:opacity-50"
				disabled={rollingBack === decision.head.id}
				onclick={() => rollBack(i, rec, decision)}>Roll back</button
			>
		{/if}
	</li>
{/snippet}

{#if editSelection}
	<EditReadingDialog
		bind:open={editOpen}
		selection={editSelection}
		title="Edit {parameterName}"
		onsuccess={() => void changed()}
	/>
{/if}
