<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import MergeParameterDialog from '$components/dialogs/MergeParameterDialog.svelte';
	import ConfirmParameterButton from '$components/parameters/ConfirmParameterButton.svelte';
	import { api, type Parameter } from '$api/crud';

	let mergeOpen = $state(false);
	let paramData = $state<Parameter | null>(null);

	$effect(() => {
		api.parameters.get(page.params.id!).then((p) => {
			paramData = p;
		});
	});
</script>

<svelte:head><title>Edit Parameter | RIVER Data</title></svelte:head>

{#if paramData?.needs_review}
	<div class="mb-4 max-w-2xl rounded-md border border-severity-warning-border bg-severity-warning-soft p-3 flex items-start justify-between gap-3">
		<p class="text-sm text-severity-warning-text">
			This entry was created mechanically and has not been confirmed. Confirm it once the code,
			name and units are the ones the catalog should keep, or merge it into an existing parameter.
		</p>
		<ConfirmParameterButton parameter={paramData} onconfirmed={(p) => (paramData = p)} />
	</div>
{/if}

<CrudForm
	client={api.parameters}
	entityId={page.params.id}
	title="Edit Parameter"
	backHref="{base}/parameters/{page.params.id}"
	fields={[
		{ key: 'code', label: 'Code', required: true, helperText: 'Short machine code for formulas and API queries, e.g. DOmgL' },
		{ key: 'name', label: 'Name', required: true, helperText: 'Human label shown in the UI, e.g. Dissolved Oxygen' },
		{ key: 'default_units', label: 'Default Units', required: true, helperText: 'Measurement unit, e.g. uM, mg/L, NTU' },
		{ key: 'category', label: 'Category', type: 'select', helperText: 'Groups parameters in the UI and public API', options: [
			{ value: 'measurement', label: 'Measurement' },
			{ value: 'device_health', label: 'Device Health' },
		] },
		{ key: 'aliases', label: 'Aliases', type: 'tags', helperText: 'Alternative names that resolve to this parameter during CSV import and stream pairing' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'default_warning_min', label: 'Warning Min', type: 'number', step: 'any', helperText: 'Below this value triggers a warning (severity 1)' },
		{ key: 'default_warning_max', label: 'Warning Max', type: 'number', step: 'any', helperText: 'Above this value triggers a warning (severity 1)' },
		{ key: 'default_alarm_min', label: 'Alarm Min', type: 'number', step: 'any', helperText: 'Below this value triggers an alarm (severity 2)' },
		{ key: 'default_alarm_max', label: 'Alarm Max', type: 'number', step: 'any', helperText: 'Above this value triggers an alarm (severity 2)' },
	]}
/>

{#if paramData}
	<div class="mt-8 pt-6 border-t border-brand-divider max-w-2xl">
		<h3 class="text-sm font-semibold text-brand-muted mb-2">Danger Zone</h3>
		<button
			onclick={() => mergeOpen = true}
			class="px-3 py-1.5 border border-severity-alarm text-severity-alarm rounded-md text-sm cursor-pointer bg-transparent hover:bg-severity-alarm/10"
		>
			Merge into another parameter…
		</button>
		<p class="mt-1 text-xs text-brand-muted">
			Absorb this parameter into another. All readings, streams, and references will be moved. This cannot be undone.
		</p>
	</div>

	<MergeParameterDialog
		bind:open={mergeOpen}
		sourceParameter={paramData}
		onsuccess={(targetId) => goto(`${base}/parameters/${targetId}`)}
	/>
{/if}
