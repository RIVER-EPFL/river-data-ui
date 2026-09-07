<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import { declareSdEstimator, retagSdEstimator, type SdEstimator } from '$api/service';
	import { estimatorLabel } from '$lib/sdEstimator';
	import Button from '$components/ui/Button.svelte';
	import type { Field } from '$components/crud/CrudForm.svelte';
	import ChangeTrail from '$components/audit/ChangeTrail.svelte';
	import PinReadingsDialog from '$components/dialogs/PinReadingsDialog.svelte';

	let siteOptions = $state<Array<{ value: string; label: string }>>([]);
	let paramOptions = $state<Array<{ value: string; label: string }>>([]);
	let declared = $state<SdEstimator | ''>('');
	// The divisor chosen in the select but not yet declared; the preview below reads it.
	let chosen = $state<SdEstimator | ''>('');
	let declareNote = $state<string | null>(null);
	let declareBusy = $state(false);
	// What declaring `chosen` would touch: samples recomputed, and samples a person chose an
	// estimator for at one instant, which a declaration leaves alone unless told otherwise.
	let previewCounts = $state<{ samples: number; instants: number } | null>(null);
	let previewError = $state<string | null>(null);
	let overrideInstants = $state(false);
	let previewSeq = 0;
	// The slot the pin dialog acts over: its site and parameter, and a name to say so.
	let slotSiteId = $state('');
	let slotParameterId = $state('');
	let slotName = $state('this parameter');
	let pinOpen = $state(false);

	onMount(async () => {
		const [sites, params, slot] = await Promise.all([
			api.sites.list({ perPage: 200 }),
			api.parameters.list({ perPage: 500 }),
			api.siteParameters.get(page.params.id!),
		]);
		siteOptions = sites.data.map((s) => ({ value: s.id, label: s.name }));
		paramOptions = params.data.map((p) => ({ value: p.id, label: p.name }));
		declared = ((slot as { sd_estimator?: SdEstimator | null }).sd_estimator ?? '') as SdEstimator | '';
		chosen = declared;
		slotSiteId = slot.site_id;
		slotParameterId = slot.parameter_id;
		slotName = params.data.find((p) => p.id === slot.parameter_id)?.name ?? slot.name ?? 'this parameter';
	});

	// The retag's dry run is the preview: the same count the declaration's job will act on,
	// split by whether the sample's estimator was chosen for its instant.
	$effect(() => {
		const target = chosen;
		previewCounts = null;
		previewError = null;
		if (target === '') return;
		const seq = ++previewSeq;
		retagSdEstimator({
			estimator: target,
			site_parameter_ids: [page.params.id!],
			override_instants: true,
			dry_run: true,
		})
			.then((r) => {
				if (seq !== previewSeq) return;
				previewCounts = {
					samples: r.samples_affected - r.instant_decisions,
					instants: r.instant_decisions,
				};
			})
			.catch((e) => {
				if (seq === previewSeq) previewError = e instanceof Error ? e.message : 'Preview failed';
			});
	});

	const unchanged = $derived(chosen === declared);

	// The declaration is not part of the CRUD form: changing it recomputes the slot's stored
	// samples, so it goes through the declare endpoint, which enqueues the tracked retag and
	// reports what it touched. Instant decisions are retagged only on request, through the retag
	// route with override_instants.
	async function declare() {
		const value = chosen;
		declareBusy = true;
		declareNote = null;
		try {
			const r = await declareSdEstimator(page.params.id!, value === '' ? null : value);
			declared = (r.estimator ?? '') as SdEstimator | '';
			chosen = declared;
			let note =
				r.samples_affected > 0
					? `${r.samples_affected} stored sample${r.samples_affected === 1 ? '' : 's'} recomputing under the ${estimatorLabel(declared || 'sample')} divisor (tracked job).`
					: value === ''
						? 'Declaration cleared. Stored samples keep the divisor they were computed with.'
						: 'Declared. No stored samples needed recomputing.';
			if (value !== '' && overrideInstants && (previewCounts?.instants ?? 0) > 0) {
				const retag = await retagSdEstimator({
					estimator: value,
					site_parameter_ids: [page.params.id!],
					override_instants: true,
				});
				note += ` ${retag.instant_decisions} instant decision${retag.instant_decisions === 1 ? '' : 's'} retagged too.`;
			}
			declareNote = note;
			overrideInstants = false;
			previewSeq++;
			previewCounts = null;
		} catch (e) {
			declareNote = e instanceof Error ? e.message : 'Declaration failed';
		} finally {
			declareBusy = false;
		}
	}

	// The retag route on its own: bring the instant decisions into line with the declaration
	// the slot already carries.
	async function retagInstants() {
		if (declared === '') return;
		declareBusy = true;
		declareNote = null;
		try {
			const r = await retagSdEstimator({
				estimator: declared,
				site_parameter_ids: [page.params.id!],
				override_instants: true,
			});
			declareNote = `${r.samples_affected} sample${r.samples_affected === 1 ? '' : 's'} recomputing under the ${estimatorLabel(declared)} divisor, ${r.instant_decisions} of them instant decisions (tracked job).`;
			previewSeq++;
			previewCounts = null;
		} catch (e) {
			declareNote = e instanceof Error ? e.message : 'Retag failed';
		} finally {
			declareBusy = false;
		}
	}

	const fields: Field[] = $derived([
		{ key: 'site_id', label: 'Site', type: 'select', required: true, options: siteOptions, disabled: true },
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions, disabled: true },
		{ key: 'display_units', label: 'Display Units', helperText: 'Overrides the parameter default units for this site' },
		{ key: 'sample_interval_sec', label: 'Sample Interval (seconds)', type: 'number', helperText: 'Expected interval between readings in seconds' },
		{ key: 'decimal_places', label: 'Decimal Places', type: 'number', helperText: 'Number of decimal places for display' },
		{ key: 'channel_id', label: 'Channel ID', type: 'number', helperText: 'External channel identifier from the data source' },
		{ key: 'sensor_type', label: 'Sensor Type', helperText: 'Measurement type label' },
		{ key: 'is_active', label: 'Active', type: 'boolean', helperText: 'Inactive site-parameters are hidden from data views' },
		{ key: 'is_public', label: 'Public', type: 'boolean', helperText: 'Expose this parameter in the public read-only API' },
	]);
</script>

<svelte:head><title>Edit Site Parameter | RIVER Data</title></svelte:head>

<CrudForm client={api.siteParameters} entityId={page.params.id} title="Edit Site Parameter" backHref="{base}/site-parameters" {fields} />

<div class="max-w-2xl mx-auto mt-4 rounded-md border border-brand-divider bg-brand-surface p-4 space-y-2">
	<div class="text-sm font-semibold">Standard deviation formula</div>
	<p class="text-xs text-brand-muted">
		Which divisor this parameter publishes its replicate standard deviation with. Undeclared uses
		sample (n-1) and holds audit disagreements matching the population divisor for a decision.
		Declaring recomputes the stored samples: only the sd moves (population sd = sample sd ×
		sqrt((n-1)/n)); the mean and the stored replicates do not change.
	</p>
	<div class="flex items-center gap-2">
		<select
			bind:value={chosen}
			disabled={declareBusy}
			class="px-2 py-1 rounded border text-sm bg-brand-surface {declared ? 'border-brand-divider' : 'border-severity-warning-border text-severity-warning-text'}"
		>
			<option value="">Not declared</option>
			<option value="sample">Sample (n-1)</option>
			<option value="population">Population (n)</option>
		</select>
		<Button size="sm" variant="primary" disabled={declareBusy || unchanged} onclick={declare}>
			{chosen === '' ? 'Clear the declaration' : `Declare ${chosen}`}
		</Button>
	</div>
	{#if !unchanged && chosen !== ''}
		<div data-testid="declare-preview" class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-1">
			{#if previewError}
				<p class="text-severity-alarm">{previewError}</p>
			{:else if previewCounts}
				<p>
					<strong>{previewCounts.samples}</strong> stored sample{previewCounts.samples === 1 ? '' : 's'} will
					recompute under the {estimatorLabel(chosen)} divisor.
				</p>
				{#if previewCounts.instants > 0}
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={overrideInstants} class="accent-brand-primary" />
						<span>
							Also retag the <strong>{previewCounts.instants}</strong> sample{previewCounts.instants === 1 ? '' : 's'}
							whose divisor was chosen for that instant in an audit resolution; unticked, they keep it.
						</span>
					</label>
				{/if}
			{:else}
				<p class="text-brand-muted">Counting the samples this touches</p>
			{/if}
			<p class="text-brand-muted">Reversible: declare the other divisor, or clear the declaration to stop recomputing.</p>
		</div>
	{:else if unchanged && declared !== '' && previewCounts && previewCounts.instants > 0}
		<div class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs space-y-1">
			<p>
				<strong>{previewCounts.instants}</strong> sample{previewCounts.instants === 1 ? '' : 's'} at this parameter
				keep{previewCounts.instants === 1 ? 's' : ''} a divisor chosen for that instant in an audit resolution
				rather than the declared {estimatorLabel(declared)}.
			</p>
			<Button size="sm" disabled={declareBusy} onclick={retagInstants}>Retag them to {declared}</Button>
		</div>
	{/if}
	{#if declareNote}<p class="text-xs text-brand-muted">{declareNote}</p>{/if}
</div>

<div class="mt-4 space-y-2">
	{#if slotSiteId && slotParameterId}
		<Button size="sm" onclick={() => (pinOpen = true)}>Pin a window of readings</Button>
		<PinReadingsDialog
			bind:open={pinOpen}
			siteId={slotSiteId}
			parameterId={slotParameterId}
			parameterName={slotName}
		/>
	{/if}
	<ChangeTrail subject={`site_parameter:${page.params.id}`} title="What has been done to this slot" />
</div>
