<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let paramOptions = $state<Array<{ value: string; label: string }>>([]);
	let siteOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [params, sites] = await Promise.all([
			api.parameters.list({ perPage: 500 }),
			api.sites.list({ perPage: 200 }),
		]);
		paramOptions = params.data.map((p) => ({ value: p.id, label: p.display_name }));
		siteOptions = sites.data.map((s) => ({ value: s.id, label: s.name }));
	});

	const fields: Field[] = $derived([
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions, disabled: true },
		{ key: 'site_id', label: 'Site', type: 'select', options: siteOptions, disabled: true },
		{ key: 'alarm_type', label: 'Type', type: 'select', required: true, options: [
			{ value: 'numeric', label: 'Numeric' },
			{ value: 'string', label: 'String' },
		] },
		{ key: 'warning_min', label: 'Warning Min', type: 'number', step: 'any' },
		{ key: 'warning_max', label: 'Warning Max', type: 'number', step: 'any' },
		{ key: 'alarm_min', label: 'Alarm Min', type: 'number', step: 'any' },
		{ key: 'alarm_max', label: 'Alarm Max', type: 'number', step: 'any' },
	]);
</script>

<svelte:head><title>Edit Threshold | River Data</title></svelte:head>

<CrudForm client={api.alarmThresholds} entityId={page.params.id} title="Edit Alarm Threshold" backHref="{base}/alarm-thresholds" {fields} />
