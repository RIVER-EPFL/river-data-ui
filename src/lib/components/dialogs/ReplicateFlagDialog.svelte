<script lang="ts">
	import { PATCH } from '$api/client';
	import type { SampleReplicate } from '$api/types';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { curveRefs } from '$lib/curveRefs.svelte';
	import { curveEquation } from '$lib/standardCurves';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		siteId,
		parameterId,
		parameterName,
		timeIso,
		replicates,
		onsuccess,
	}: {
		open: boolean;
		siteId: string;
		parameterId: string;
		parameterName: string;
		timeIso: string;
		replicates: SampleReplicate[];
		onsuccess?: () => void;
	} = $props();

	let reason = $state('');
	let busyIndex = $state<number | null>(null);
	let openChain = $state<number | null>(null);

	$effect(() => {
		if (!open) return;
		reason = '';
		openChain = null;
		curveRefs.ensureCalibrations(replicates.map((r) => r.calibration_id));
		curveRefs.ensureStandardCurves(replicates.map((r) => r.standard_curve_id));
	});

	const ordered = $derived([...replicates].sort((a, b) => a.replicate_index - b.replicate_index));

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
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : `Failed to ${mode} the replicate`);
		} finally {
			busyIndex = null;
		}
	}
</script>

<Dialog bind:open title="Replicates: {parameterName}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="text-xs text-brand-muted font-mono">{formatDateTime(timeIso)}</div>
			<p class="text-sm text-brand-text">
				Flagging one replicate excludes it from the sample mean; the remaining replicates are
				recomputed. The other replicates at this timestamp are untouched.
			</p>
			<div>
				<label for="replicate-flag-reason" class="text-sm font-medium block mb-1">Reason</label>
				<input
					id="replicate-flag-reason"
					type="text"
					bind:value={reason}
					placeholder="e.g. pipetting error, contaminated vial"
					class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
				/>
				<p class="text-xs text-brand-muted mt-1">Required to flag, ignored when restoring.</p>
			</div>
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-brand-divider">
						<th class="text-left py-1 font-semibold">Replicate</th>
						<th class="text-right py-1 font-semibold">Value</th>
						<th class="text-left py-1 font-semibold">Calibration</th>
						<th class="text-left py-1 font-semibold">Standard curve</th>
						<th class="text-right py-1 font-semibold">State</th>
						<th class="text-right py-1"></th>
					</tr>
				</thead>
				<tbody>
					{#each ordered as rep}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="py-1.5 font-mono">{rep.replicate_index}</td>
							<td class="py-1.5 text-right font-mono">
								<button
									type="button"
									class="underline decoration-dotted underline-offset-2 hover:text-brand-primary"
									aria-expanded={openChain === rep.replicate_index}
									onclick={() =>
										(openChain = openChain === rep.replicate_index ? null : rep.replicate_index)}
									title="Show how this value was corrected"
								>
									{(rep.calibrated_value ?? rep.raw_value).toFixed(3)}
								</button>
							</td>
							<td class="py-1.5 text-xs {rep.calibration_id ? '' : 'text-brand-muted'}">
								{curveRefs.calibrationLabel(rep.calibration_id)}
							</td>
							<td class="py-1.5 text-xs {rep.standard_curve_id ? '' : 'text-brand-muted'}">
								{curveRefs.standardCurveLabel(rep.standard_curve_id)}
							</td>
							<td class="py-1.5 text-right {rep.flagged ? 'text-severity-alarm' : 'text-brand-muted'}">
								{rep.flagged ? 'Flagged' : 'Included'}
							</td>
							<td class="py-1.5 text-right">
								<Button
									size="sm"
									variant={rep.flagged ? 'secondary' : 'danger'}
									disabled={busyIndex != null}
									onclick={() => toggle(rep)}
								>
									{busyIndex === rep.replicate_index ? 'Saving…' : rep.flagged ? 'Restore' : 'Flag'}
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
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Close</Button>
	{/snippet}
</Dialog>
