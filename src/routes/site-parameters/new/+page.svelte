<script lang="ts">
	import { base } from '$app/paths';
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
		{ key: 'site_id', label: 'Site', type: 'select', required: true, options: siteOptions },
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions },
		{ key: 'display_units', label: 'Display Units', helperText: 'Overrides the parameter default' },
		{ key: 'sample_interval_sec', label: 'Sample Interval (seconds)', type: 'number' },
		{ key: 'decimal_places', label: 'Decimal Places', type: 'number' },
		{ key: 'channel_id', label: 'Channel ID', type: 'number' },
		{ key: 'sensor_type', label: 'Sensor Type' },
		{ key: 'is_active', label: 'Active', type: 'boolean', defaultValue: true },
	]);
</script>

<svelte:head><title>New Site Parameter | River Data</title></svelte:head>

<CrudForm client={api.siteParameters} title="New Site Parameter" backHref="{base}/site-parameters" {fields} />
