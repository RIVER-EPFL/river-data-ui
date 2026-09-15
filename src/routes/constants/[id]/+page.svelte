<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import ConstantConsequence from '$components/constants/ConstantConsequence.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { api } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS, CONSTANTS_REFUSED } from '$lib/toolbox/authoring';

	let name = $state('');

	$effect(() => {
		const id = page.params.id;
		if (!id) return;
		api.constants
			.get(id)
			.then((c) => (name = c.name))
			.catch(() => (name = ''));
	});
</script>

<svelte:head><title>Edit Constant | RIVER Data</title></svelte:head>

<ConstantConsequence {name} />

{#if !me.can(AUTHOR_CALCULATIONS)}
	<ErrorNotice message={CONSTANTS_REFUSED} />
{:else}
	<CrudForm
		client={api.constants}
		entityId={page.params.id}
		title="Edit Constant"
		backHref="{base}/parameters?tab=constants"
		fields={[
			{ key: 'name', label: 'Name', required: true, helperText: 'Identifier used in formulas, e.g. molar_weight_o2' },
			{ key: 'value', label: 'Value', type: 'number', required: true, step: 'any', helperText: 'Numeric constant value' },
			{ key: 'units', label: 'Units', helperText: 'Unit of the constant, e.g. g/mol' },
			{ key: 'description', label: 'Description', type: 'textarea' },
		]}
	/>
{/if}
