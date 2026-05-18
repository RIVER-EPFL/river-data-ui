<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { search, type SearchResponse } from '$api/service';

	let query = $state('');
	let results = $state<SearchResponse | null>(null);
	let open = $state(false);
	let loading = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout>;

	onDestroy(() => clearTimeout(debounceTimer));

	function handleInput() {
		clearTimeout(debounceTimer);
		if (!query.trim()) { results = null; open = false; return; }
		debounceTimer = setTimeout(async () => {
			loading = true;
			try {
				results = await search(query.trim());
				open = true;
			} catch { results = null; }
			finally { loading = false; }
		}, 300);
	}

	function navigate(type: string, id: string) {
		open = false; query = '';
		goto(`${base}/${type}/${id}`);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); } }} />

<div class="relative">
	<input
		id="global-search"
		type="text"
		placeholder="Search... (Ctrl+K)"
		bind:value={query}
		oninput={handleInput}
		onfocus={() => results && (open = true)}
		onkeydown={handleKeydown}
		class="w-48 lg:w-64 px-3 py-1 bg-white/15 text-white placeholder-white/60 rounded-md text-sm border-none focus:outline-none focus:bg-white/25"
	/>

	{#if open && results && results.total > 0}
		<div class="absolute top-full mt-1 right-0 w-80 bg-brand-surface text-brand-text border border-brand-divider rounded-md shadow-lg max-h-80 overflow-y-auto z-50">
			{#if results.results.sites.length > 0}
				<div class="px-3 py-1.5 text-xs font-semibold text-brand-muted bg-brand-bg">Sites</div>
				{#each results.results.sites as item}
					<button onclick={() => navigate('sites', item.id)} class="w-full text-left px-3 py-1.5 text-sm text-brand-text hover:bg-brand-bg cursor-pointer bg-transparent border-none">{item.name}</button>
				{/each}
			{/if}
			{#if results.results.sensors.length > 0}
				<div class="px-3 py-1.5 text-xs font-semibold text-brand-muted bg-brand-bg">Sensors</div>
				{#each results.results.sensors as item}
					<button onclick={() => navigate('sensors', item.id)} class="w-full text-left px-3 py-1.5 text-sm text-brand-text hover:bg-brand-bg cursor-pointer bg-transparent border-none">
						{item.serial_number ?? ''} {item.name ? `(${item.name})` : ''}
					</button>
				{/each}
			{/if}
			{#if results.results.parameters.length > 0}
				<div class="px-3 py-1.5 text-xs font-semibold text-brand-muted bg-brand-bg">Parameters</div>
				{#each results.results.parameters as item}
					<button onclick={() => navigate('parameters', item.id)} class="w-full text-left px-3 py-1.5 text-sm text-brand-text hover:bg-brand-bg cursor-pointer bg-transparent border-none">{item.display_name}</button>
				{/each}
			{/if}
			{#if results.results.projects.length > 0}
				<div class="px-3 py-1.5 text-xs font-semibold text-brand-muted bg-brand-bg">Projects</div>
				{#each results.results.projects as item}
					<button onclick={() => navigate('projects', item.id)} class="w-full text-left px-3 py-1.5 text-sm text-brand-text hover:bg-brand-bg cursor-pointer bg-transparent border-none">{item.name}</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
