<script lang="ts">
	let { items }: { items: { label: string; href?: string }[] } = $props();
</script>

<nav aria-label="Breadcrumb" class="flex items-center gap-2 text-sm text-brand-muted mb-1">
	{#each items as item, i}
		{#if i > 0}<span>/</span>{/if}
		{#if item.href}
			<a href={item.href} class="hover:text-brand-primary no-underline">{item.label}</a>
		{:else}
			<span>{item.label}</span>
		{/if}
	{/each}
</nav>
