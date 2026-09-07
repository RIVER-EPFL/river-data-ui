<script lang="ts">
	import { type Site } from '$api/crud';
	import { siteRefs } from '$lib/siteRefs.svelte';

	// Site picker over the shared catalog. A host holding its own list (a project's sites, a
	// token's scope) passes it in; everything else reads `siteRefs` and pays for one fetch per
	// session. `placeholder` is the empty option's label, `null` for a select that must hold a
	// site.
	let {
		value = $bindable(''),
		sites = null,
		placeholder = ' - Select site - ',
		ariaLabel = 'Site',
		id = undefined,
		disabled = false,
		class: className = 'px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm',
		onchange = null,
	}: {
		value: string;
		sites?: Site[] | null;
		placeholder?: string | null;
		ariaLabel?: string;
		id?: string;
		disabled?: boolean;
		class?: string;
		onchange?: ((siteId: string) => void) | null;
	} = $props();

	const options = $derived(sites ?? siteRefs.all);

	$effect(() => {
		if (!sites) void siteRefs.ensure();
	});
</script>

<select
	{id}
	{disabled}
	aria-label={ariaLabel}
	class={className}
	bind:value
	onchange={() => onchange?.(value)}
>
	{#if placeholder !== null}<option value="">{placeholder}</option>{/if}
	{#each options as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
</select>
