<script lang="ts">
	import { page } from '$app/state';
	import DerivedParameterForm from '$components/derived/DerivedParameterForm.svelte';
</script>

<DerivedParameterForm mode="edit" defId={page.params.id!} />
