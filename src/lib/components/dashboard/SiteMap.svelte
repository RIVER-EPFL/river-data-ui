<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { Site } from '$api/crud';
	import { tokens } from '$lib/charts/tokens';

	let {
		sites,
		selectedSiteId = $bindable(undefined),
		filterProjectId,
		height = '300px',
	}: {
		sites: Site[];
		selectedSiteId?: string;
		filterProjectId?: string;
		height?: string;
	} = $props();

	let el: HTMLDivElement;
	let map: L.Map | null = null;
	let markerGroup: any = null;

	const filteredSites = $derived(
		filterProjectId
			? sites.filter((s) => s.project_id === filterProjectId && s.latitude && s.longitude)
			: sites.filter((s) => s.latitude && s.longitude),
	);

	async function initMap() {
		const L = await import('leaflet');
		await import('leaflet.markercluster');
		await import('leaflet/dist/leaflet.css');
		await import('leaflet.markercluster/dist/MarkerCluster.css');
		await import('leaflet.markercluster/dist/MarkerCluster.Default.css');

		if (map) { map.remove(); map = null; }

		map = L.map(el, { zoomControl: true, attributionControl: false }).setView([46.2, 7.1], 10);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 18,
		}).addTo(map);

		markerGroup = (L as any).markerClusterGroup({ maxClusterRadius: 40 });

		for (const site of filteredSites) {
			const isSelected = site.id === selectedSiteId;
			const icon = L.divIcon({
				className: '',
				html: `<div style="width:12px;height:12px;border-radius:50%;background:${isSelected ? tokens.brand.accent : tokens.brand.primary};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);${isSelected ? 'transform:scale(1.5);' : ''}"></div>`,
				iconSize: [12, 12],
				iconAnchor: [6, 6],
			});

			const marker = L.marker([site.latitude!, site.longitude!], { icon })
				.bindTooltip(site.name, { permanent: false, direction: 'top', offset: [0, -8] });

			marker.on('click', () => {
				selectedSiteId = site.id;
				goto(`${base}/sites/${site.id}`);
			});

			markerGroup.addLayer(marker);
		}

		map.addLayer(markerGroup);

		if (filteredSites.length > 0) {
			const bounds = L.latLngBounds(filteredSites.map((s) => [s.latitude!, s.longitude!]));
			map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
		}
	}

	$effect(() => {
		if (el && filteredSites) initMap();
	});

	onDestroy(() => { map?.remove(); });
</script>

<div bind:this={el} style:height class="w-full rounded-md border border-brand-divider overflow-hidden"></div>
