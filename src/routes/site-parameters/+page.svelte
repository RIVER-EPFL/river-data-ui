<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';
	import OriginBadge from '$components/crud/OriginBadge.svelte';
	import OriginFilter from '$components/crud/OriginFilter.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import { originFilter, type Origin } from '$lib/origin';
	import { api, type Site, type Parameter, type SiteParameter } from '$api/crud';

	let siteMap = $state<Map<string, string>>(new Map());
	let paramMap = $state<Map<string, string>>(new Map());
	let origin = $state<Origin>('any');

	onMount(async () => {
		const [sites, params] = await Promise.all([
			api.sites.list({ perPage: 200 }),
			api.parameters.list({ perPage: 500 }),
		]);
		siteMap = new Map(sites.data.map((s: Site) => [s.id, s.name]));
		paramMap = new Map(params.data.map((p: Parameter) => [p.id, p.name]));
	});

	// Unconfirmed slots first: they are the only rows on this page carrying a decision.
	async function loadSiteParameters({ page, perPage, sort }: PageRequest) {
		return api.siteParameters.list({
			page,
			perPage,
			sort,
			filter: originFilter(origin, 'discovered_at'),
		});
	}
</script>

<svelte:head><title>Site Parameters | RIVER Data</title></svelte:head>

<CrudList
	load={loadSiteParameters}
	title="Site Parameters"
	createHref="{base}/site-parameters/new"
	defaultSort={['needs_review', 'DESC']}
	columns={[
		{ key: 'site_id', label: 'Site', render: (_, row) => siteMap.get(row.site_id) ?? 'None' },
		{ key: 'parameter_id', label: 'Parameter', render: (_, row) => paramMap.get(row.parameter_id) ?? 'None' },
		{ key: 'display_units', label: 'Units' },
		{ key: 'sample_interval_sec', label: 'Interval (s)' },
		{ key: 'entry_mode', label: 'Entry', render: (v) => v === 'tool' ? 'Tool' : 'Manual' },
		{ key: 'is_active', label: 'Active', render: (v) => v === false ? 'No' : 'Yes' },
		{ key: 'origin', label: 'Origin', sortable: false },
	]}
	rowHref={(row) => `${base}/site-parameters/${row.id}`}
>
	{#snippet filterBar({ reload }: { reload: () => void })}
		<OriginFilter bind:value={origin} onchange={reload} />
	{/snippet}

	{#snippet cell({ column, row, text }: { column: Column; row: SiteParameter; text: string })}
		{#if column.key === 'origin'}
			<OriginBadge discoveredAt={row.discovered_at} />
			{#if row.needs_review}
				<Badge variant="warning">needs review</Badge>
			{/if}
		{:else}
			{text}
		{/if}
	{/snippet}
</CrudList>
