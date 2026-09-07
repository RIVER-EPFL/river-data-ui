<script lang="ts">
	import { base } from '$app/paths';
	import {
		getReadingProvenance,
		type ProvenanceResponse,
		type ProvenanceRecord,
		type ProvenanceReading,
		type ProvenanceCalibrationRef,
		type StreamReceipt,
		type HoldKind,
		getReadingDecisions,
		rollbackEdit,
		type ReadingDecision,
	} from '$api/service';
	import type { SampleReplicate } from '$api/types';
	import { replicatesOf } from '$lib/provenance/replicates';
	import { curveLabel, formatEquation } from '$lib/standardCurves';
	import { provenanceKindLabel } from '$lib/origin';
	import { NO_VALUE, formatCount, formatMeasurement, numericCell } from '$lib/format';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ProvenanceCard from '$components/samples/ProvenanceCard.svelte';
	import EditReadingDialog from '$components/dialogs/EditReadingDialog.svelte';
	import { EDIT_METHODS } from '$lib/provenance/edits';

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
		// Shown as a "Flag replicates" action on a spot group, handed the group's replicates.
		onflag?: (replicates: SampleReplicate[]) => void;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	let resp = $state<ProvenanceResponse | null>(null);
	let showToolRun = $state<Set<number>>(new Set());
	// The decision history of one record, fetched on demand: it is the audit trail, not part of
	// the value, so it is not on the critical path of reading the record.
	let showDecisions = $state<Set<number>>(new Set());
	let decisions = $state<Record<number, ReadingDecision[]>>({});
	let decisionsError = $state<Record<number, string>>({});
	let rollingBack = $state<string | null>(null);
	let editOpen = $state(false);
	let editSelection = $state<{ keys: { stream_id: string; time: string }[] } | null>(null);

	/** A decision that still stands, so rolling it back is a thing that can be done. */
	function live(d: ReadingDecision): boolean {
		return !d.rolled_back_by && d.kind !== 'rollback';
	}

	function decisionLabel(kind: string): string {
		return (EDIT_METHODS as Record<string, { label: string }>)[kind]?.label ?? kind;
	}

	async function toggleDecisions(i: number, rec: ProvenanceRecord) {
		const next = new Set(showDecisions);
		if (next.has(i)) {
			next.delete(i);
			showDecisions = next;
			return;
		}
		next.add(i);
		showDecisions = next;
		await loadDecisions(i, rec);
	}

	async function loadDecisions(i: number, rec: ProvenanceRecord) {
		try {
			decisions = {
				...decisions,
				[i]: await getReadingDecisions({ stream_id: rec.origin.stream_id, time: timeIso }),
			};
			decisionsError = { ...decisionsError, [i]: '' };
		} catch (e) {
			decisionsError = {
				...decisionsError,
				[i]: e instanceof Error ? e.message : String(e),
			};
		}
	}

	async function rollBack(i: number, rec: ProvenanceRecord, d: ReadingDecision) {
		rollingBack = d.id;
		try {
			await rollbackEdit(d.id);
			toastStore.success(`${decisionLabel(d.kind)} rolled back`);
			await loadDecisions(i, rec);
			await load();
		} catch (e) {
			decisionsError = {
				...decisionsError,
				[i]: e instanceof Error ? e.message : String(e),
			};
		} finally {
			rollingBack = null;
		}
	}

	function openEdit(rec: ProvenanceRecord) {
		editSelection = { keys: [{ stream_id: rec.origin.stream_id, time: timeIso }] };
		editOpen = true;
	}

	const ORIGIN_LABEL: Record<string, string> = {
		sync: 'Synced',
		manual: 'Manual entry',
		csv: 'CSV import',
		api: 'API batch',
	};

	const HOLD_LABEL: Record<HoldKind, string> = {
		replicate_stats: 'Statistics disagreement',
		source_modified: 'Source modified curated data',
		brake_fired: 'Reconciliation brake',
		missing_output: 'Missing tool output',
		stale_output: 'Stale tool output',
		curve_claim_stripped: 'Curve claim stripped',
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

	function cadence(rec: ProvenanceRecord): string {
		return rec.readings[0]?.measurement_type ?? 'continuous';
	}

	function calibrationWindow(c: ProvenanceCalibrationRef): string {
		return `valid ${formatDateTime(c.valid_from)} to ${c.valid_until ? formatDateTime(c.valid_until) : 'open'}`;
	}

	function stateText(r: ProvenanceReading): string {
		if (r.withdrawn_at) return `withdrawn${r.withdrawn_reason ? `: ${r.withdrawn_reason}` : ''}`;
		if (r.is_flagged) return `flagged${r.flag_reason ? `: ${r.flag_reason}` : ''}`;
		return NO_VALUE;
	}

	function stateTip(r: ProvenanceReading): string | undefined {
		if (r.withdrawn_at) return `Withdrawn ${formatDateTime(r.withdrawn_at)}; the source no longer claims this value.`;
		return undefined;
	}

	function arrivedText(r: ProvenanceReading): string {
		return r.ingested_at ? formatDateTime(r.ingested_at) : NO_VALUE;
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

	function receiptText(rc: StreamReceipt): string {
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

	function computationText(rec: ProvenanceRecord): string {
		if (!rec.computation?.provenance) return NO_VALUE;
		const src = rec.computation.run_source;
		if (src === 'chain') return 'recomputed by chain';
		if (src && src !== 'interactive') return src;
		return 'tool run';
	}

	function computationTip(rec: ProvenanceRecord): string {
		return rec.computation?.provenance
			? 'Computed by a recorded tool run; open it from the actions below.'
			: 'Hand-entered measurement, no tool run recorded.';
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
		if (preloaded) {
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
		showDecisions = new Set();
		error = '';
		void load();
	});

	function toggleToolRun(i: number) {
		const next = new Set(showToolRun);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		showToolRun = next;
	}

	function originBadge(rec: ProvenanceRecord): { label: string; variant: 'accent' | 'muted' } {
		if (rec.origin.classification === 'sync')
			return { label: `${rec.origin.source_system} sync`, variant: 'accent' };
		return { label: ORIGIN_LABEL[rec.origin.classification] ?? rec.origin.classification, variant: 'muted' };
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
	{:else}
		{NO_VALUE}
	{/if}
{/snippet}

{#snippet recordFields(rec: ProvenanceRecord)}
	{@render field('Instrument', instrumentText(rec), 'The instrument and deployment attributed to this measurement.', false)}
	{@render field('Standard deviation', estimatorText(rec), estimatorTip(rec), false)}
	{@render field('Computation', computationText(rec), computationTip(rec), false)}
	{#if rec.computation?.created_by}
		{@render field('Entered by', rec.computation.created_by, undefined, false)}
	{/if}
	{#if rec.origin.receipt}
		{@render field('Reconciliation', receiptText(rec.origin.receipt), 'The latest windowed pass whose claimed window covers this instant.', false)}
	{/if}
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
					{#if rec.origin.ingested_at}
						<span class="text-brand-muted">arrived {formatDateTime(rec.origin.ingested_at)}</span>
					{/if}
					{#if rec.origin.paired_at}
						<span class="text-brand-muted">paired {formatDateTime(rec.origin.paired_at)}</span>
					{/if}
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
					<dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
						{@render field(`Measured${units ? ` (${units})` : ''}`, fmt(r.raw_value), undefined, true)}
						{@render field(
							`Corrected${units ? ` (${units})` : ''}`,
							fmt(r.calibrated_value),
							undefined,
							true,
						)}
						<div class="contents" title="The windowed calibration applied to the measurement.">
							<dt class="py-0.5 text-xs text-brand-muted">Calibration</dt>
							<dd class="py-0.5 text-brand-text">{@render calibrationCell(r, rec.chain.sensor?.id)}</dd>
						</div>
						<div class="contents" title="The lab curve chosen for this measurement.">
							<dt class="py-0.5 text-xs text-brand-muted">Standard curve</dt>
							<dd class="py-0.5 text-brand-text">{@render curveCell(r)}</dd>
						</div>
						{@render field('State', stateText(r), stateTip(r), false)}
						{@render field('Arrived', arrivedText(r), 'When this value reached the store.', false)}
						{@render field('Origin', originText(r), 'Which write path produced this value.', false)}
						{@render recordFields(rec)}
					</dl>
				{:else}
					<table class="mt-1 w-full text-left">
						<thead class="text-xs text-brand-muted">
							<tr>
								<th class="py-0.5 pr-3 font-medium">Replicate</th>
								<th class="py-0.5 pr-3 text-right font-medium">Measured{units ? ` (${units})` : ''}</th>
								<th class="py-0.5 pr-3 text-right font-medium">Corrected{units ? ` (${units})` : ''}</th>
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
										{:else}
											<span class="text-brand-muted">{NO_VALUE}</span>
										{/if}
									</td>
									<td class="py-0.5 text-xs text-brand-muted">{arrivedText(r)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
						{@render recordFields(rec)}
					</dl>
				{/if}

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
								? 'synced from the portal'
								: 'entered by hand'}{rec.event.created_by ? ` by ${rec.event.created_by}` : ''}."
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
						onclick={() => toggleDecisions(i, rec)}
						>{showDecisions.has(i) ? 'Hide decisions' : 'Show decisions'}</button
					>
				</div>
				{#if showDecisions.has(i)}
					<div class="mt-2 text-xs">
						{#if decisionsError[i]}
							<ErrorNotice message={decisionsError[i]} />
						{:else if (decisions[i] ?? []).length === 0}
							<p class="text-gray-500">
								Nobody has decided anything about this reading: it stands as it arrived.
							</p>
						{:else}
							<ul class="space-y-1">
								{#each decisions[i] ?? [] as d (d.id)}
									<li class="flex flex-wrap items-baseline gap-x-2">
										<span class="font-medium">{decisionLabel(d.kind)}</span>
										<span class="text-gray-500">
											{formatDateTime(d.at)} · {d.actor} · {d.origin}
										</span>
										{#if d.reason}<span class="text-gray-500">“{d.reason}”</span>{/if}
										{#if d.rolled_back_by}
											<span class="text-gray-400">rolled back</span>
										{:else if live(d)}
											<button
												class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline disabled:opacity-50"
												disabled={rollingBack === d.id}
												onclick={() => rollBack(i, rec, d)}>Roll back</button
											>
										{/if}
									</li>
								{/each}
							</ul>
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

{#if editSelection}
	<EditReadingDialog
		bind:open={editOpen}
		selection={editSelection}
		title="Edit {parameterName}"
		onsuccess={() => void load()}
	/>
{/if}
