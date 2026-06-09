<script lang="ts">
	import { base } from '$app/paths';
	import ParameterCatalogList from '$components/parameters/ParameterCatalogList.svelte';
</script>

<svelte:head><title>Parameters | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-xl font-semibold">Parameters</h2>
		<div class="flex items-center gap-2 shrink-0">
			<a href="{base}/parameters/new" class="px-3 py-1.5 border border-brand-divider rounded-md no-underline text-sm font-semibold text-brand-text bg-brand-surface hover:bg-brand-bg">Create parameter</a>
			<a href="{base}/derived/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create derived parameter</a>
		</div>
	</div>
	<ParameterCatalogList />
</div>
