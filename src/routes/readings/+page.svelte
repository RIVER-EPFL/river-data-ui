<script lang="ts">
	import { onMount } from 'svelte';

	import { api, type Parameter, type Sensor, type Site, type StandardCurve } from '$api/crud';
	import { listAll } from '$api/paged';
	import ReadingsList from '$components/readings/ReadingsList.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { siteRefs } from '$lib/siteRefs.svelte';

	let sites = $state<Site[] | null>(null);
	let parameters = $state<Parameter[] | null>(null);
	let instruments = $state<Sensor[] | null>(null);
	let curves = $state<StandardCurve[] | null>(null);
	let error = $state('');

	onMount(async () => {
		try {
			[sites, parameters, instruments, curves] = await Promise.all([
				siteRefs.ensure(),
				listAll(api.parameters, { perPage: 500, sort: ['code', 'ASC'] }),
				listAll(api.sensors, { perPage: 500, sort: ['name', 'ASC'] }),
				listAll(api.standardCurves, { perPage: 500 }),
			]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'The filters could not be loaded';
		}
	});
</script>

<svelte:head><title>Readings · RIVER Data</title></svelte:head>

<div class="space-y-4">
	<Breadcrumbs items={[{ label: 'Readings' }]} />
	{#if error}
		<ErrorNotice message={error} />
	{:else if sites && parameters && instruments && curves}
		<ReadingsList {sites} {parameters} {instruments} {curves} />
	{:else}
		<p class="text-brand-muted">Loading…</p>
	{/if}
</div>
