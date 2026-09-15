<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { me } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS, authoringState } from '$lib/toolbox/authoring';
	const access = $derived(authoringState({ permitted: me.can(AUTHOR_CALCULATIONS), refused: false }));
</script>

<svelte:head><title>New Parameter Group | RIVER Data</title></svelte:head>

{#if access.authorable}
<CrudForm
	client={api.parameterGroups}
	title="New Parameter Group"
	backHref="{base}/parameters?tab=groups"
	fields={[
		{ key: 'code', label: 'Code', required: true, helperText: 'Stable machine identity, e.g. field_data' },
		{ key: 'label', label: 'Label', required: true, derivedFrom: 'code', helperText: 'What the group is called on screen. Follows the code until you type one of your own.' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'ordinal', label: 'Order', type: 'number', step: '1', defaultValue: 0, helperText: 'Where the group sits in the category order' },
	]}
/>
{:else}
	<ErrorNotice message={access.notice} />
{/if}
