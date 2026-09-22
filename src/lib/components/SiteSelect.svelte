<script lang="ts">
	import { siteRefs } from '$lib/siteRefs.svelte';

	// Site picker over the shared catalog. A host holding its own list (a project's sites, a
	// token's scope, its own order) passes it in; everything else reads `siteRefs` and pays for
	// one fetch per session. `placeholder` is the empty option's label, `null` for a select that
	// must hold a site.
	/** What the picker needs of a site: the value it writes and the name it shows. */
	interface Option {
		id: string;
		name: string;
	}

	let {
		value = $bindable(''),
		sites = null,
		note = null,
		placeholder = ' - Select site - ',
		ariaLabel = 'Site',
		id = undefined,
		disabled = false,
		class: className = 'px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm',
		onchange = null,
	}: {
		value: string;
		sites?: Option[] | null;
		/** A word after a site's name saying what it is for this choice, where the host has one. */
		note?: ((site: Option) => string) | null;
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
	{#each options as s (s.id)}
		{@const said = note?.(s) ?? ''}
		<option value={s.id}>{s.name}{said ? ` · ${said}` : ''}</option>
	{/each}
</select>
