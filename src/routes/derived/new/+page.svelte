<script lang="ts">
	import DerivedParameterForm from '$components/derived/DerivedParameterForm.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { me } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS, authoringState } from '$lib/toolbox/authoring';
	const access = $derived(authoringState({ permitted: me.can(AUTHOR_CALCULATIONS), refused: false }));
</script>

{#if access.authorable}
	<DerivedParameterForm mode="create" />
{:else}
	<ErrorNotice message={access.notice} />
{/if}
