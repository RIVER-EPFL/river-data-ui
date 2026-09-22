<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$api/crud';
	import { calculationHref } from '$lib/toolbox/route';

	// A formula is edited on its calculation's page and nowhere else. This route is what the
	// links made before that held, so it opens the calculation on the formula it names.
	onMount(async () => {
		const id = page.params.id!;
		try {
			const formula = await api.derivedParameters.get(id);
			await goto(
				formula.tool_script_id
					? calculationHref(base, { tool_script_id: formula.tool_script_id }, { cell: formula.code })
					: `${base}/derived/${id}`,
				{ replaceState: true },
			);
		} catch {
			await goto(`${base}/parameters?type=derived`, { replaceState: true });
		}
	});
</script>

<svelte:head><title>Opening the calculation… | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Opening the calculation…</p>
