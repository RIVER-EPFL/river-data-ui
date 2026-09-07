<script lang="ts">
	import { page } from '$app/state';
	import DerivedParameterForm from '$components/derived/DerivedParameterForm.svelte';

	// `?calculation=` is how the Toolbox opens this form for one calculation: the formula it
	// authors belongs to that calculation instead of standing alone.
	const calculationId = $derived(page.url.searchParams.get('calculation'));
</script>

<DerivedParameterForm mode="create" {calculationId} />
