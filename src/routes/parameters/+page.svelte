<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS } from '$lib/toolbox/authoring';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import ParameterCatalogList from '$components/parameters/ParameterCatalogList.svelte';

	// Capture the direct/derived filter from the URL before the tab writeback rewrites ?tab.
	const initialType =
		page.url.searchParams.get('type') ??
		(page.url.searchParams.get('tab') === 'derived' ? 'derived' : '');

	// Legacy ?tab=derived deep links land on the catalog with the derived filter pre-applied.
	const tab = createUrlTab({ keys: ['catalog', 'groups', 'constants'], aliases: { derived: 'catalog' } });
</script>

<svelte:head><title>Parameters | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-xl font-semibold">Parameters</h2>
		<div class="flex items-center gap-2 shrink-0">
			{#if tab.key === 'catalog'}
				<a href="{base}/parameters/new" class="px-3 py-1.5 border border-brand-divider rounded-md no-underline text-sm font-semibold text-brand-text bg-brand-surface hover:bg-brand-bg">Create parameter</a>
				{#if me.can(AUTHOR_CALCULATIONS)}
					<a href="{base}/derived/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">Create derived parameter</a>
				{/if}
			{:else if tab.key === 'groups'}
				{#if me.can(AUTHOR_CALCULATIONS)}
					<a href="{base}/parameters/groups/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">New group</a>
				{/if}
			{:else}
				<a href="{base}/constants/new" class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark">New constant</a>
			{/if}
		</div>
	</div>

	<Tabs tabs={['Catalog', 'Groups', 'Constants']} bind:active={tab.index} />

	{#if tab.key === 'catalog'}
		<ParameterCatalogList {initialType} />
	{:else if tab.key === 'groups'}
		<CrudList
			client={api.parameterGroups}
			title="Groups"
			showHeader={false}
			searchable
			defaultSort={['ordinal', 'ASC']}
			columns={[
				{ key: 'ordinal', label: 'Order', sortable: true },
				{ key: 'label', label: 'Label', sortable: true },
				{ key: 'code', label: 'Code', sortable: true },
				{ key: 'description', label: 'Description', class: 'text-brand-muted' },
			]}
			rowHref={(row) => `${base}/parameters/groups/${row.id}`}
		/>
	{:else}
		<CrudList
			client={api.constants}
			title="Constants"
			showHeader={false}
			searchable
			columns={[
				{ key: 'name', label: 'Name' },
				{ key: 'value', label: 'Value' },
				{ key: 'units', label: 'Units' },
				{ key: 'description', label: 'Description', class: 'text-brand-muted' },
			]}
			rowHref={(row) => `${base}/constants/${row.id}`}
		/>
	{/if}
</div>
