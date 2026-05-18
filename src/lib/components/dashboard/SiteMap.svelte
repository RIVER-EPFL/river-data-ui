<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Site } from '$api/crud';
	import { tokens } from '$lib/charts/tokens';

	let {
		sites,
		selectedSiteId = $bindable(undefined),
		filterProjectId,
		height = '300px',
		onSiteClick,
		siteAlarmSeverity,
	}: {
		sites: Site[];
		selectedSiteId?: string;
		filterProjectId?: string;
		height?: string;
		onSiteClick?: (siteId: string) => void;
		siteAlarmSeverity?: (siteId: string) => 'ok' | 'warning' | 'alarm';
	} = $props();

	let el: HTMLDivElement;
	let map: L.Map | null = null;
	let markerGroup: any = null;

	const severityColor: Record<string, string> = {
		ok: tokens.severity.ok.main,
		warning: tokens.severity.warning.main,
		alarm: tokens.severity.alarm.main,
	};

	const filteredSites = $derived(
		(filterProjectId
			? sites.filter((s) => s.project_id === filterProjectId)
			: sites
		).filter((s) => s.latitude && s.longitude),
	);

	async function initMap() {
		const L = await import('leaflet');
		await import('leaflet.markercluster');
		await import('leaflet/dist/leaflet.css');
		await import('leaflet.markercluster/dist/MarkerCluster.css');
		await import('leaflet.markercluster/dist/MarkerCluster.Default.css');

		if (map) { map.remove(); map = null; }

		map = L.map(el, { zoomControl: true, attributionControl: false }).setView([46.2, 7.1], 10);

		const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 18,
			attribution: '&copy; OpenStreetMap',
		});

		const swisstopoRaster = L.tileLayer(
			'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
			{ maxZoom: 18, attribution: '&copy; swisstopo' },
		);

		const swisstopoAerial = L.tileLayer(
			'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
			{ maxZoom: 20, attribution: '&copy; swisstopo' },
		);

		osmLayer.addTo(map);
		L.control.layers({
			'OpenStreetMap': osmLayer,
			'SwissTopo': swisstopoRaster,
			'SwissTopo Aerial': swisstopoAerial,
		}).addTo(map);

		markerGroup = (L as any).markerClusterGroup({ maxClusterRadius: 40, spiderfyOnMaxZoom: true });

		for (const site of filteredSites) {
			const severity = siteAlarmSeverity?.(site.id) ?? 'ok';
			const color = severityColor[severity];
			const size = 22;
			const icon = L.divIcon({
				className: '',
				html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;transition:transform 0.15s;" onmouseenter="this.style.transform='scale(1.3)'" onmouseleave="this.style.transform='scale(1)'"></div>`,
				iconSize: [size, size],
				iconAnchor: [size / 2, size / 2],
			});

			const marker = L.marker([site.latitude!, site.longitude!], { icon })
				.bindTooltip(site.name, { permanent: false, direction: 'right', offset: [12, 0] });

			marker.on('click', () => {
				onSiteClick?.(site.id);
			});

			markerGroup.addLayer(marker);
		}

		map.addLayer(markerGroup);

		if (filteredSites.length > 0) {
			const bounds = L.latLngBounds(filteredSites.map((s) => [s.latitude!, s.longitude!]));
			map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: true });
		}
	}

	let mounted = false;
	onMount(() => { mounted = true; });

	$effect(() => {
		const _sites = filteredSites;
		if (mounted && el) initMap();
	});

	onDestroy(() => { map?.remove(); });
</script>

<div bind:this={el} style:height class="w-full rounded-md border border-brand-divider overflow-hidden"></div>
