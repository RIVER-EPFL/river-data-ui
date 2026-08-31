<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import { declareSdEstimator, type SdEstimator } from '$api/service';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let siteOptions = $state<Array<{ value: string; label: string }>>([]);
	let paramOptions = $state<Array<{ value: string; label: string }>>([]);
	let declared = $state<SdEstimator | ''>('');
	let declareNote = $state<string | null>(null);
	let declareBusy = $state(false);

	onMount(async () => {
		const [sites, params, slot] = await Promise.all([
			api.sites.list({ perPage: 200 }),
			api.parameters.list({ perPage: 500 }),
			api.siteParameters.get(page.params.id!),
		]);
		siteOptions = sites.data.map((s) => ({ value: s.id, label: s.name }));
		paramOptions = params.data.map((p) => ({ value: p.id, label: p.name }));
		declared = ((slot as { sd_estimator?: SdEstimator | null }).sd_estimator ?? '') as SdEstimator | '';
	});

	// The declaration is not part of the CRUD form: changing it recomputes the slot's stored
	// samples, so it goes through the declare endpoint, which enqueues the tracked retag and
	// reports what it touched.
	async function declare(value: SdEstimator | '') {
		declareBusy = true;
		declareNote = null;
		try {
			const r = await declareSdEstimator(page.params.id!, value === '' ? null : value);
			declared = (r.estimator ?? '') as SdEstimator | '';
			declareNote =
				r.samples_affected > 0
					? `${r.samples_affected} stored sample${r.samples_affected === 1 ? '' : 's'} recomputing under the new divisor (tracked job).`
					: value === ''
						? 'Declaration cleared. Stored samples keep the divisor they were computed with.'
						: 'Declared. No stored samples needed recomputing.';
		} catch (e) {
			declareNote = e instanceof Error ? e.message : 'Declaration failed';
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

<svelte:head><title>Edit Site Parameter | River Data</title></svelte:head>

<CrudForm client={api.siteParameters} entityId={page.params.id} title="Edit Site Parameter" backHref="{base}/site-parameters" {fields} />

<div class="max-w-2xl mx-auto mt-4 rounded-md border border-brand-divider bg-brand-surface p-4 space-y-2">
	<div class="text-sm font-semibold">Standard deviation formula</div>
	<p class="text-xs text-brand-muted">
		Which divisor this parameter publishes its replicate standard deviation with. Undeclared uses
		sample (n-1) and holds audit disagreements matching the population divisor for a decision.
		Changing it recomputes the stored samples.
	</p>
	<select
		value={declared}
		disabled={declareBusy}
		onchange={(e) => declare(e.currentTarget.value as SdEstimator | '')}
		class="px-2 py-1 rounded border text-sm bg-brand-surface {declared ? 'border-brand-divider' : 'border-severity-warning-border text-severity-warning-text'}"
	>
		<option value="">Not declared</option>
		<option value="sample">Sample (n-1)</option>
		<option value="population">Population (n)</option>
	</select>
	{#if declareNote}<p class="text-xs text-brand-muted">{declareNote}</p>{/if}
</div>
