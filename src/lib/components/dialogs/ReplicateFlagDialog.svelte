<script lang="ts">
	import { PATCH } from '$api/client';
	import { getReadingProvenance, previewSample, type SamplePreviewResponse } from '$api/service';
	import { sdFormulaTitle, sdRowLabel } from '$lib/sdEstimator';
	import type { SampleReplicate } from '$api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { curveRefs } from '$lib/curveRefs.svelte';
	import { curveEquation } from '$lib/standardCurves';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ProvenanceCard from '$components/samples/ProvenanceCard.svelte';
	import { formatMeasurement } from '$lib/format';

	let {
		open = $bindable(false),
		siteId,
		parameterId,
		parameterName,
		units = null,
		decimals = null,
		timeIso,
		replicates,
		onsuccess,
	}: {
		open: boolean;
		siteId: string;
		parameterId: string;
		parameterName: string;
		/** The unit the slot serves, printed on the value column. */
		units?: string | null;
		/** `site_parameters.decimal_places`; null falls back to significant digits. */
		decimals?: number | null;
		timeIso: string;
		replicates: SampleReplicate[];
		/** The `samples` row behind the point, the only place its tool-run provenance is stored. */
		onsuccess?: () => void;
	} = $props();

	const FLAG_HELP =
		'Flagging one replicate excludes it from the sample mean; the remaining replicates are recomputed. The other replicates at this timestamp are untouched.';

	let reason = $state('');
	let busyIndex = $state<number | null>(null);
	// The replicate chosen for a flag or restore, held until the preview has been read and the
	// change confirmed; nothing is written before that.
	let armed = $state<{ index: number; mode: 'flag' | 'unflag' } | null>(null);
	let preview = $state<SamplePreviewResponse | null>(null);
	let previewError = $state<string | null>(null);
	let previewSeq = 0;
	let openChain = $state<number | null>(null);
	// Provenance lives on the reading, not on the points the chart drew, so it is fetched here.
	let provenance = $state<Record<string, unknown> | null>(null);
	let provenanceLoading = $state(false);
	let provenanceOpen = $state(false);

	$effect(() => {
		if (!open) return;
		reason = '';
		openChain = null;
		armed = null;
		preview = null;
		previewError = null;
		curveRefs.ensureCalibrations(replicates.map((r) => r.calibration_id));
		curveRefs.ensureStandardCurves(replicates.map((r) => r.standard_curve_id));
	});

	$effect(() => {
		if (!open) return;
		const at = timeIso;
		provenance = null;
		provenanceOpen = false;
		if (!siteId || !parameterId || !at) return;
		provenanceLoading = true;
		getReadingProvenance({ site_id: siteId, parameter_id: parameterId, time: at, measurement_type: 'spot' })
			.then((res) => {
				if (timeIso !== at) return;
				provenance =
					res.records.find((r) => r.computation?.provenance)?.computation?.provenance ?? null;
			})
			.catch(() => {
				// A record the caller cannot read leaves the section out rather than reporting a
				// failure: the flagging actions above are unaffected.
			})
			.finally(() => {
				provenanceLoading = false;
			});
	});

	const ordered = $derived([...replicates].sort((a, b) => a.replicate_index - b.replicate_index));

	function arm(rep: SampleReplicate) {
		const mode = rep.flagged ? 'unflag' : 'flag';
		armed = { index: rep.replicate_index, mode };
		preview = null;
		previewError = null;
		const seq = ++previewSeq;
		previewSample({
			site_id: siteId,
			parameter_id: parameterId,
			time: timeIso,
			...(mode === 'flag'
				? { exclude_replicate_indexes: [rep.replicate_index] }
				: { include_replicate_indexes: [rep.replicate_index] }),
		})
			.then((p) => {
				if (seq === previewSeq) preview = p;
			})
			.catch((e) => {
				if (seq === previewSeq) previewError = e instanceof Error ? e.message : 'Preview failed';
			});
	}

	function disarm() {
		armed = null;
		preview = null;
		previewError = null;
	}

	async function toggle(rep: SampleReplicate) {
		const mode = rep.flagged ? 'unflag' : 'flag';
		if (mode === 'flag' && !reason.trim()) {
			toastStore.error('Reason is required to flag a replicate');
			return;
		}
		busyIndex = rep.replicate_index;
		try {
			const body: Record<string, unknown> = {
				readings: [
					{
						site_id: siteId,
						parameter_id: parameterId,
						time: timeIso,
						replicate_index: rep.replicate_index,
						measurement_type: 'spot',
					},
				],
			};
			if (mode === 'flag') body.reason = reason.trim();
			const res = await PATCH<{ updated: number }>(`/api/readings/${mode}`, body);
			if (res.updated === 0) {
				toastStore.info('That replicate was already in the requested state');
			} else {
				toastStore.success(`${mode === 'flag' ? 'Flagged' : 'Unflagged'} replicate ${rep.replicate_index}`);
			}
			disarm();
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : `Failed to ${mode} the replicate`);
		} finally {
			busyIndex = null;
		}
	}

	const armedReplicate = $derived(
		armed ? (ordered.find((r) => r.replicate_index === armed!.index) ?? null) : null,
	);
</script>

<Dialog bind:open title="Replicates: {parameterName}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="text-xs text-brand-muted font-mono">{formatDateTime(timeIso)}</div>
			<table class="w-full text-sm table-fixed">
				<colgroup>
					<col style="width:4.5rem" />
					<col style="width:7rem" />
					<col style="width:9rem" />
					<col style="width:9rem" />
					<col style="width:6rem" />
					<col style="width:5.5rem" />
				</colgroup>
				<thead>
					<tr class="border-b border-brand-divider">
						<th class="text-left py-1 pr-2 font-semibold">Replicate</th>
						<th class="text-right py-1 pr-2 font-semibold whitespace-nowrap">Value{units ? ` (${units})` : ''}</th>
						<th class="text-left py-1 pr-2 font-semibold">Calibration</th>
						<th class="text-left py-1 pr-2 font-semibold">Standard curve</th>
						<th class="text-right py-1 pr-2 font-semibold">State</th>
						<th
							class="text-right py-1 font-semibold"
							title={FLAG_HELP}>Flag</th>
					</tr>
				</thead>
				<tbody>
					{#each ordered as rep}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="py-1.5 pr-2 font-mono">{rep.replicate_index}</td>
							<td class="py-1.5 pr-2 text-right font-mono tabular-nums">
								<button
									type="button"
									class="underline decoration-dotted underline-offset-2 hover:text-brand-primary"
									aria-expanded={openChain === rep.replicate_index}
									onclick={() =>
										(openChain = openChain === rep.replicate_index ? null : rep.replicate_index)}
									title="Show how this value was corrected"
								>
									{formatMeasurement(rep.calibrated_value ?? rep.raw_value, decimals)}
								</button>
							</td>
							<td class="py-1.5 pr-2 text-xs truncate {rep.calibration_id ? '' : 'text-brand-muted'}"
								title={curveRefs.calibrationLabel(rep.calibration_id)}>
								{curveRefs.calibrationLabel(rep.calibration_id)}
							</td>
							<td class="py-1.5 pr-2 text-xs truncate {rep.standard_curve_id ? '' : 'text-brand-muted'}"
								title={curveRefs.standardCurveLabel(rep.standard_curve_id)}>
								{curveRefs.standardCurveLabel(rep.standard_curve_id)}
							</td>
							<td
								class="py-1.5 pr-2 text-right {rep.flagged || rep.withdrawn
									? 'text-severity-alarm'
									: 'text-brand-muted'}"
								title={rep.withdrawn
									? 'The source no longer claims this value; it is already out of the mean'
									: undefined}
							>
								{rep.withdrawn ? 'Withdrawn' : rep.flagged ? 'Flagged' : 'Included'}
							</td>
							<td class="py-1.5 text-right">
								<Button
									size="sm"
									variant={rep.flagged ? 'secondary' : 'danger'}
									disabled={busyIndex != null || rep.withdrawn || armed?.index === rep.replicate_index}
									onclick={() => arm(rep)}
								>
									{busyIndex === rep.replicate_index ? 'Saving' : rep.flagged ? 'Restore' : 'Flag'}
								</Button>
							</td>
						</tr>
						{#if openChain === rep.replicate_index}
							{@const base = curveRefs.calibration(rep.calibration_id)}
							{@const curve = curveRefs.standardCurve(rep.standard_curve_id)}
							{@const composed = curveRefs.composed(rep.calibration_id, rep.standard_curve_id)}
							<tr class="border-b border-brand-divider last:border-b-0 bg-brand-surface-muted">
								<td colspan="6" class="py-2 px-3">
									<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
										<dt class="text-brand-muted">Measured</dt>
										<dd class="font-mono">{rep.raw_value}</dd>
										<dt class="text-brand-muted">Calibration</dt>
										<dd>
											{curveRefs.calibrationLabel(rep.calibration_id)}
											{#if base}<span class="font-mono ml-2">{curveEquation(base)}</span>{/if}
										</dd>
										<dt class="text-brand-muted">Standard curve</dt>
										<dd>
											{curveRefs.standardCurveLabel(rep.standard_curve_id)}
											{#if curve}<span class="font-mono ml-2">{curveEquation(curve)}</span>{/if}
										</dd>
										<dt class="text-brand-muted">Applied</dt>
										<dd class="font-mono">
											{#if composed}
												{curveEquation(composed)}
											{:else}
												No curve applied, the measured value is served
											{/if}
										</dd>
										<dt class="text-brand-muted">Result</dt>
										<dd class="font-mono">{rep.calibrated_value ?? rep.raw_value}</dd>
									</dl>
									{#if curve && base}
										<p class="text-xs text-brand-muted mt-2">
											The standard curve is applied on top of the calibration, so the two compose
											into the single equation above.
										</p>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
			{#if armed && armedReplicate}
				<div data-testid="sample-preview" class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-2">
					<p class="font-semibold">
						{armed.mode === 'flag' ? 'Flagging' : 'Restoring'} replicate {armed.index}
					</p>
					{#if previewError}
						<p class="text-severity-alarm">{previewError}</p>
					{:else if preview}
						<table class="w-full">
							<thead class="text-brand-muted">
								<tr>
									<th class="text-left font-medium py-0.5">Statistic</th>
									<th class="text-right font-medium py-0.5">Now</th>
									<th class="text-right font-medium py-0.5">After</th>
									<th class="text-right font-medium py-0.5">Change</th>
								</tr>
							</thead>
							<tbody class="font-mono tabular-nums">
								<tr>
									<td class="font-sans text-brand-muted py-0.5">Mean</td>
									<td class="text-right">{formatMeasurement(preview.current.mean, decimals)}</td>
									<td class="text-right">{formatMeasurement(preview.proposed.mean, decimals)}</td>
									<td class="text-right">{formatMeasurement(preview.delta.mean, decimals)}</td>
								</tr>
								<tr>
									<td class="font-sans text-brand-muted py-0.5" title={sdFormulaTitle(preview.proposed.sd_estimator)}>
										{sdRowLabel(preview.proposed.sd_estimator)}
									</td>
									<td class="text-right">{formatMeasurement(preview.current.sd, decimals)}</td>
									<td class="text-right">{formatMeasurement(preview.proposed.sd, decimals)}</td>
									<td class="text-right">{formatMeasurement(preview.delta.sd, decimals)}</td>
								</tr>
								<tr>
									<td class="font-sans text-brand-muted py-0.5">n</td>
									<td class="text-right">{preview.current.n}</td>
									<td class="text-right">{preview.proposed.n}</td>
									<td class="text-right">{preview.delta.n}</td>
								</tr>
							</tbody>
						</table>
					{:else}
						<p class="text-brand-muted">Computing the statistics without it</p>
					{/if}
					<p class="text-brand-muted">
						{#if armed.mode === 'flag'}
							The value stays on the row with the reason beside it, outside the mean and sd; the
							decision is recorded on the reading and Restore reverses it.
						{:else}
							The value returns to the mean and sd; the decision is recorded on the reading.
						{/if}
					</p>
					<div class="flex gap-2 justify-end">
						<Button size="sm" variant="secondary" onclick={disarm}>Cancel</Button>
						<Button
							size="sm"
							variant={armed.mode === 'flag' ? 'danger' : 'primary'}
							disabled={busyIndex != null}
							onclick={() => toggle(armedReplicate!)}
						>
							{armed.mode === 'flag' ? `Flag replicate ${armed.index}` : `Restore replicate ${armed.index}`}
						</Button>
					</div>
				</div>
			{/if}
			<div class="flex items-end gap-3">
				<div class="flex-1">
					<label for="replicate-flag-reason" class="text-sm font-medium block mb-1">Reason</label>
					<input
						id="replicate-flag-reason"
						type="text"
						bind:value={reason}
						placeholder="e.g. pipetting error, contaminated vial"
						class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
					/>
				</div>
				<p class="text-xs text-brand-muted pb-2">Required to flag, ignored when restoring.</p>
			</div>
			{#if provenanceLoading}
				<p class="text-xs text-brand-muted">Loading tool run…</p>
			{:else if provenance}
				<div class="space-y-2">
					<Button size="sm" variant="ghost" onclick={() => (provenanceOpen = !provenanceOpen)}>
						{provenanceOpen ? 'Hide tool run' : 'Show tool run'}
					</Button>
					{#if provenanceOpen}
						<ProvenanceCard {provenance} />
					{/if}
				</div>
			{:else}
				<p class="text-xs text-brand-muted">Hand-entered measurement, no tool run recorded.</p>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Close</Button>
	{/snippet}
</Dialog>
