<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let siteOptions = $state<Array<{ value: string; label: string }>>([]);
	let paramOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [sites, params] = await Promise.all([
			api.sites.list({ perPage: 200 }),
			api.parameters.list({ perPage: 500 }),
		]);
		siteOptions = sites.data.map((s) => ({ value: s.id, label: s.name }));
		paramOptions = params.data.map((p) => ({ value: p.id, label: p.display_name }));
	});

	const fields: Field[] = $derived([
		{ key: 'site_id', label: 'Site', type: 'select', required: true, options: siteOptions, disabled: true },
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions, disabled: true },
		{ key: 'display_units', label: 'Display Units', helperText: 'Overrides the parameter default units for this site' },
		{ key: 'sample_interval_sec', label: 'Sample Interval (seconds)', type: 'number', helperText: 'Expected interval between readings in seconds' },
		{ key: 'decimal_places', label: 'Decimal Places', type: 'number', helperText: 'Number of decimal places for display' },
		{ key: 'channel_id', label: 'Channel ID', type: 'number', helperText: 'External channel identifier from the data source' },
		{ key: 'sensor_type', label: 'Sensor Type', helperText: 'Measurement type label' },
		{ key: 'is_active', label: 'Active', type: 'boolean', helperText: 'Inactive site-parameters are hidden from data views' },
	]);
</script>

<svelte:head><title>Edit Site Parameter | River Data</title></svelte:head>

<CrudForm client={api.siteParameters} entityId={page.params.id} title="Edit Site Parameter" backHref="{base}/site-parameters" {fields} />
