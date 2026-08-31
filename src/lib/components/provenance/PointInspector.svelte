<script lang="ts">
	import { base } from '$app/paths';
	import {
		getReadingProvenance,
		type ProvenanceResponse,
		type ProvenanceRecord,
		type HoldKind,
	} from '$api/service';
	import { formatEquation } from '$lib/standardCurves';
	import { formatDateTime } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ProvenanceCard from '$components/samples/ProvenanceCard.svelte';

	// The record of one measured instant, pinned in place under its chart or table row.
	let {
		siteId,
		parameterId,
		parameterName,
		timeIso,
		measurementType,
		onclose,
		onflag,
	}: {
		siteId: string;
		parameterId: string;
		parameterName: string;
		timeIso: string;
		measurementType?: string;
		onclose?: () => void;
		// Shown as a "Flag replicates…" action when the point is a replicate group.
		onflag?: (sampleId: string | null) => void;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	let resp = $state<ProvenanceResponse | null>(null);
	let showToolRun = $state<Set<number>>(new Set());

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
	};

	function fmt(v: number): string {
		if (!Number.isFinite(v)) return String(v);
		return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
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

<div class="mt-2 rounded-lg border border-brand-divider bg-brand-surface p-4 text-sm">
	<div class="mb-3 flex items-start justify-between gap-2">
		<div>
			<span class="font-medium text-brand-text">{parameterName}</span>
			<span class="ml-2 text-brand-muted">{formatDateTime(timeIso)}</span>
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
			<p class="mb-3 rounded bg-severity-warning-soft px-2 py-1 text-severity-warning-text">
				{resp.records.length} streams serve this slot at this instant. Each record is shown.
			</p>
		{/if}
		{#each resp.records as rec, i (rec.origin.stream_id)}
			<div class={i > 0 ? 'mt-4 border-t border-brand-divider pt-4' : ''}>
				<div class="flex flex-wrap items-center gap-2">
					<Badge variant={originBadge(rec).variant}>{originBadge(rec).label}</Badge>
					<span class="text-brand-muted">{rec.origin.source_key}</span>
					{#if rec.origin.ingested_at}
						<span class="text-brand-muted">· arrived {formatDateTime(rec.origin.ingested_at)}</span>
					{/if}
				</div>
				{#if rec.origin.receipt}
					<p class="mt-1 text-brand-muted">
						Last reconciliation pass {formatDateTime(rec.origin.receipt.at)}:
						{rec.origin.receipt.new_rows} new, {rec.origin.receipt.changed} changed,
						{rec.origin.receipt.withdrawn} withdrawn
						{#if rec.origin.receipt.braked}<Badge variant="warning">brake fired</Badge>{/if}
					</p>
				{/if}

				<table class="mt-3 w-full text-left">
					<thead class="text-xs text-brand-muted">
						<tr>
							{#if rec.readings.length > 1}<th class="py-1 pr-3 font-medium">Replicate</th>{/if}
							<th class="py-1 pr-3 font-medium">Measured</th>
							<th class="py-1 pr-3 font-medium">Corrected</th>
							<th class="py-1 pr-3 font-medium">Applied</th>
							<th class="py-1 font-medium">State</th>
						</tr>
					</thead>
					<tbody>
						{#each rec.readings as r (r.replicate_index)}
							<tr class="border-t border-brand-divider/60 {r.withdrawn_at ? 'opacity-60' : ''}">
								{#if rec.readings.length > 1}
									<td class="py-1 pr-3 text-brand-muted">{r.replicate_index}</td>
								{/if}
								<td class="py-1 pr-3 {r.withdrawn_at ? 'line-through' : ''}">{fmt(r.raw_value)}</td>
								<td class="py-1 pr-3 {r.withdrawn_at ? 'line-through' : ''}">
									{r.calibrated_value != null ? fmt(r.calibrated_value) : '—'}
								</td>
								<td class="py-1 pr-3 text-brand-muted">
									{#if r.calibration}
										<span title="Base calibration">{formatEquation(r.calibration.slope, r.calibration.intercept)}</span>
									{/if}
									{#if r.standard_curve}
										<span title="Standard curve{r.standard_curve.name ? `: ${r.standard_curve.name}` : ''}">
											{r.calibration ? ' then ' : ''}{formatEquation(r.standard_curve.slope, r.standard_curve.intercept)}
										</span>
									{/if}
									{#if !r.calibration && !r.standard_curve}Not corrected{/if}
								</td>
								<td class="py-1">
									{#if r.withdrawn_at}
										<Badge variant="muted">withdrawn</Badge>
									{:else if r.is_flagged}
										<Badge variant="warning">flagged{r.flag_reason ? `: ${r.flag_reason}` : ''}</Badge>
									{:else}
										<span class="text-brand-muted">—</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<div class="mt-3 flex flex-col gap-1 text-brand-muted">
					{#if rec.chain.sensor}
						<span>
							Instrument:
							<a
								class="text-brand-primary hover:underline"
								href="{base}/sensors/{rec.chain.sensor.id}"
							>
								{rec.chain.sensor.serial_number ?? rec.chain.sensor.name ?? rec.chain.sensor.id}
							</a>
							{#if rec.chain.sensor.manufacturer || rec.chain.sensor.model}
								({[rec.chain.sensor.manufacturer, rec.chain.sensor.model].filter(Boolean).join(' ')})
							{/if}
							{#if rec.chain.deployment}
								, deployed at {rec.chain.deployment.site_name ?? 'site'}
								since {formatDateTime(rec.chain.deployment.deployed_from)}
							{/if}
						</span>
					{/if}
					{#if rec.event}
						<span>
							Visit:
							<a
								class="text-brand-primary hover:underline"
								href="{base}/sites/{siteId}?tab=visits&event={rec.event.id}"
							>
								{formatDateTime(rec.event.collected_at)}
							</a>
							· {rec.event.source === 'portal_sync' ? 'sync' : 'manual'}
							{#if rec.event.created_by}· {rec.event.created_by}{/if}
						</span>
					{/if}
				</div>

				{#if rec.holds.length > 0}
					<div class="mt-2 flex flex-wrap gap-2">
						{#each rec.holds as h (h.id)}
							<a href="{base}/streams?tab=audits" class="inline-flex">
								<Badge variant={h.status === 'pending' ? 'warning' : 'muted'}>
									{HOLD_LABEL[h.kind] ?? h.kind} · {h.status}
								</Badge>
							</a>
						{/each}
					</div>
				{/if}

				{#if rec.computation}
					{@const est = rec.computation.sd_estimator}
					{@const src = rec.computation.sd_estimator_source}
					<p class="mt-2 text-xs text-brand-muted">
						Standard deviation: <span class="text-brand-text">{est === 'population' ? 'population (n)' : 'sample (n-1)'}</span>
						{#if src === 'default'}
							<span class="text-severity-warning-text">
								— not declared for this parameter, so the sample formula applies by default
							</span>
						{:else if src === 'sample'}
							— chosen for this collection group
						{:else if src === 'slot'}
							— declared for this parameter
						{:else if src === 'stream'}
							— declared by the source
						{:else}
							— fixed by the tool
						{/if}
					</p>
				{/if}

				<div class="mt-3 flex items-center gap-2">
					{#if rec.computation?.provenance}
						<Button variant="ghost" size="sm" onclick={() => toggleToolRun(i)}>
							{showToolRun.has(i) ? 'Hide tool run' : 'Show tool run'}
						</Button>
						{#if rec.computation.run_source && rec.computation.run_source !== 'interactive'}
							<Badge variant="muted">
								{rec.computation.run_source === 'chain' ? 'recomputed by chain' : rec.computation.run_source}
							</Badge>
						{/if}
					{:else if rec.computation}
						<span class="text-brand-muted">Hand-entered sample, no tool run recorded.</span>
					{/if}
					{#if onflag && rec.readings.length > 0 && rec.readings.some((r) => r.measurement_type === 'spot')}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => onflag(rec.computation?.sample_id ?? null)}
						>
							Flag replicates…
						</Button>
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
