<script lang="ts">
	import { base } from '$app/paths';
	import {
		getReadingProvenance,
		type ProvenanceResponse,
		type ProvenanceRecord,
		type ProvenanceReading,
		type HoldKind,
	} from '$api/service';
	import { formatEquation } from '$lib/standardCurves';
	import { formatDateTime } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ProvenanceCard from '$components/samples/ProvenanceCard.svelte';

	// The record of one measured instant, pinned in place under its chart or table row.
	let {
		siteId,
		parameterId,
		parameterName,
		units = null,
		timeIso,
		measurementType,
		onclose,
		onflag,
	}: {
		siteId: string;
		parameterId: string;
		parameterName: string;
		/** The unit the slot serves. Printed on the value columns; the caller resolves it. */
		units?: string | null;
		timeIso: string;
		measurementType?: string;
		onclose?: () => void;
		// Shown as a "Flag replicates" action when the point is a replicate group.
		onflag?: () => void;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	let resp = $state<ProvenanceResponse | null>(null);
	let showToolRun = $state<Set<number>>(new Set());

	// The placeholder for an absent value, everywhere in this panel.
	const NONE = '-';

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

	function fmt(v: number): string {
		if (!Number.isFinite(v)) return String(v);
		return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
	}

	function correctionText(r: ProvenanceReading): string {
		const parts: string[] = [];
		if (r.calibration) parts.push(formatEquation(r.calibration.slope, r.calibration.intercept));
		if (r.standard_curve) parts.push(formatEquation(r.standard_curve.slope, r.standard_curve.intercept));
		return parts.length > 0 ? parts.join(' then ') : NONE;
	}

	function estimatorText(rec: ProvenanceRecord): string {
		const est = rec.computation?.sd_estimator;
		if (!est) return NONE;
		return est === 'population' ? 'population (n)' : 'sample (n-1)';
	}

	function estimatorTip(rec: ProvenanceRecord): string {
		const src = rec.computation?.sd_estimator_source;
		if (!rec.computation?.sd_estimator) return 'No standard deviation is served for this instant.';
		return ESTIMATOR_TIP[src ?? 'default'] ?? '';
	}

	function computationText(rec: ProvenanceRecord): string {
		if (!rec.computation?.provenance) return NONE;
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

	function receiptTip(rec: ProvenanceRecord): string | undefined {
		const rc = rec.origin.receipt;
		if (!rc) return undefined;
		return `Last reconciliation pass ${formatDateTime(rc.at)}: ${rc.new_rows} new, ${rc.changed} changed, ${rc.withdrawn} withdrawn${rc.braked ? ', brake fired' : ''}.`;
	}

	function flaggable(rec: ProvenanceRecord): boolean {
		return rec.readings.some((r) => r.measurement_type === 'spot');
	}

	$effect(() => {
		const key = `${siteId}|${parameterId}|${timeIso}|${measurementType ?? ''}`;
		void key;
		loading = true;
		error = '';
		resp = null;
		showToolRun = new Set();
		getReadingProvenance({
			time: timeIso,
			site_id: siteId,
			parameter_id: parameterId,
			measurement_type: measurementType,
		})
			.then((r) => (resp = r))
			.catch((e) => (error = e instanceof Error ? e.message : 'Could not load the record'))
			.finally(() => (loading = false));
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
		{#if resp.duplicate_slot}
			<p class="mt-2 rounded bg-severity-warning-soft px-2 py-1 text-xs text-severity-warning-text">
				{resp.records.length} streams serve this slot at this instant. Each record is shown.
			</p>
		{/if}
		{#each resp.records as rec, i (rec.origin.stream_id)}
			<div class={i > 0 ? 'mt-3 border-t border-brand-divider pt-3' : 'mt-2'}>
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" title={receiptTip(rec)}>
					<Badge variant={originBadge(rec).variant}>{originBadge(rec).label}</Badge>
					<span class="text-brand-muted">{rec.origin.source_key}</span>
					{#if rec.origin.ingested_at}
						<span class="text-brand-muted">arrived {formatDateTime(rec.origin.ingested_at)}</span>
					{/if}
					{#if rec.origin.receipt?.braked}<Badge variant="warning">brake fired</Badge>{/if}
					{#each rec.holds as h (h.id)}
						<a href="{base}/streams?tab=audits" class="inline-flex">
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
							r.calibrated_value != null ? fmt(r.calibrated_value) : NONE,
							undefined,
							true,
						)}
						{@render field(
							'Calibration',
							r.calibration ? formatEquation(r.calibration.slope, r.calibration.intercept) : NONE,
							'The windowed calibration applied to the measurement.',
							false,
						)}
						{@render field(
							'Standard curve',
							r.standard_curve ? formatEquation(r.standard_curve.slope, r.standard_curve.intercept) : NONE,
							r.standard_curve?.name ?? 'The lab curve chosen for this measurement.',
							false,
						)}
						{@render field(
							'State',
							r.withdrawn_at
								? 'withdrawn'
								: r.is_flagged
									? `flagged${r.flag_reason ? `: ${r.flag_reason}` : ''}`
									: NONE,
							r.withdrawn_reason ?? undefined,
							false,
						)}
						{@render field('Standard deviation', estimatorText(rec), estimatorTip(rec), false)}
						{@render field('Computation', computationText(rec), computationTip(rec), false)}
					</dl>
				{:else}
					<table class="mt-1 w-full text-left">
						<thead class="text-xs text-brand-muted">
							<tr>
								<th class="py-0.5 pr-3 font-medium">Replicate</th>
								<th class="py-0.5 pr-3 text-right font-medium">Measured{units ? ` (${units})` : ''}</th>
								<th class="py-0.5 pr-3 text-right font-medium">Corrected{units ? ` (${units})` : ''}</th>
								<th class="py-0.5 pr-3 font-medium">Applied</th>
								<th class="py-0.5 font-medium">State</th>
							</tr>
						</thead>
						<tbody>
							{#each rec.readings as r (r.replicate_index)}
								<tr class="border-t border-brand-divider/60 {r.withdrawn_at ? 'opacity-60' : ''}">
									<td class="py-0.5 pr-3 text-brand-muted">{r.replicate_index}</td>
									<td class="py-0.5 pr-3 text-right font-mono tabular-nums {r.withdrawn_at ? 'line-through' : ''}"
										>{fmt(r.raw_value)}</td
									>
									<td class="py-0.5 pr-3 text-right font-mono tabular-nums {r.withdrawn_at ? 'line-through' : ''}">
										{r.calibrated_value != null ? fmt(r.calibrated_value) : NONE}
									</td>
									<td class="py-0.5 pr-3 text-brand-muted">{correctionText(r)}</td>
									<td class="py-0.5">
										{#if r.withdrawn_at}
											<Badge variant="muted">withdrawn</Badge>
										{:else if r.is_flagged}
											<Badge variant="warning">flagged{r.flag_reason ? `: ${r.flag_reason}` : ''}</Badge>
										{:else}
											<span class="text-brand-muted">{NONE}</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
						{@render field('Standard deviation', estimatorText(rec), estimatorTip(rec), false)}
						{@render field('Computation', computationText(rec), computationTip(rec), false)}
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
							onclick={() => onflag()}>Flag replicates</button
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
							title="{rec.chain.sensor.serial_number ?? rec.chain.sensor.name ?? rec.chain.sensor.id}{[
								rec.chain.sensor.manufacturer,
								rec.chain.sensor.model,
							]
								.filter(Boolean)
								.join(' ')
								? ` (${[rec.chain.sensor.manufacturer, rec.chain.sensor.model].filter(Boolean).join(' ')})`
								: ''}{rec.chain.deployment
								? `, deployed at ${rec.chain.deployment.site_name ?? 'site'} since ${formatDateTime(rec.chain.deployment.deployed_from)}`
								: ''}">Open instrument</a
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
				</div>
				{#if rec.computation?.provenance && showToolRun.has(i)}
					<div class="mt-2">
						<ProvenanceCard provenance={rec.computation.provenance} />
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>
