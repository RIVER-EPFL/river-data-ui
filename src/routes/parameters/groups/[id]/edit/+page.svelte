<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { me } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS, authoringState } from '$lib/toolbox/authoring';
	const access = $derived(authoringState({ permitted: me.can(AUTHOR_CALCULATIONS), refused: false }));
	const groupId = page.params.id!;
</script>

<svelte:head><title>Edit Parameter Group | RIVER Data</title></svelte:head>

{#if access.authorable}
<CrudForm
	client={api.parameterGroups}
	entityId={groupId}
	title="Edit Parameter Group"
	backHref="{base}/parameters/groups/{groupId}"
	fields={[
		{ key: 'code', label: 'Code', required: true, helperText: 'Stable machine identity, e.g. field_data. A pairing plan resolves a group by this code, so renaming it here without renaming it at the source makes the next plan create a second group.' },
		{ key: 'label', label: 'Label', required: true, helperText: 'What the group is called on screen' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'ordinal', label: 'Order', type: 'number', step: '1', helperText: 'Where the group sits in the category order' },
	]}
/>
{:else}
	<ErrorNotice message={access.notice} />
{/if}
