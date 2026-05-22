<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Site } from '$api/crud';
	import { tokens } from '$lib/charts/tokens';

	export type SiteStatus = {
		severity: 'ok' | 'warning' | 'alarm';
		alarmCount: number;
		warningCount: number;
		latestReadingTime: string | null;
		projectName: string | null;
	};

	let {
		sites,
		selectedSiteId = $bindable(undefined),
		filterProjectId,
		height = '300px',
		onSiteClick,
		siteStatus,
	}: {
		sites: Site[];
		selectedSiteId?: string;
		filterProjectId?: string;
		height?: string;
		onSiteClick?: (siteId: string) => void;
		siteStatus?: (siteId: string) => SiteStatus;
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

	function escapeHtml(s: string): string {
		return s.replace(/[&<>"']/g, (c) => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
		})[c]!);
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return 'no data';
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return 'no data';
		const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
		if (diffSec < 60) return `${diffSec}s ago`;
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.floor(diffHr / 24);
		if (diffDay < 30) return `${diffDay}d ago`;
		const diffMo = Math.floor(diffDay / 30);
		if (diffMo < 12) return `${diffMo}mo ago`;
		return `${Math.floor(diffMo / 12)}y ago`;
	}

	function tooltipHtml(site: Site, status: SiteStatus): string {
		const name = escapeHtml(site.name);
		const project = status.projectName ? escapeHtml(status.projectName) : '';
		const header = project
			? `<div style="font-weight:600;font-size:13px;">${name}</div><div style="color:#9ca3af;font-size:11px;margin-bottom:6px;">${project}</div>`
			: `<div style="font-weight:600;font-size:13px;margin-bottom:6px;">${name}</div>`;

		const chips: string[] = [];
		if (status.alarmCount > 0) {
			chips.push(`<span style="background:${tokens.severity.alarm.main};color:white;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:600;">${status.alarmCount} alarm${status.alarmCount === 1 ? '' : 's'}</span>`);
		}
		if (status.warningCount > 0) {
			chips.push(`<span style="background:${tokens.severity.warning.main};color:white;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:600;">${status.warningCount} warning${status.warningCount === 1 ? '' : 's'}</span>`);
		}
		const chipRow = chips.length
			? `<div style="display:flex;gap:4px;margin-bottom:6px;">${chips.join('')}</div>`
			: '';

		const last = `<div style="font-size:11px;color:#d1d5db;">Last data: ${relativeTime(status.latestReadingTime)}</div>`;

		return `<div style="min-width:140px;">${header}${chipRow}${last}</div>`;
	}

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
			const status: SiteStatus = siteStatus?.(site.id) ?? {
				severity: 'ok',
				alarmCount: 0,
				warningCount: 0,
				latestReadingTime: null,
				projectName: null,
			};
			const color = severityColor[status.severity];
			const size = 22;
			const icon = L.divIcon({
				className: '',
				html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;transition:transform 0.15s;" onmouseenter="this.style.transform='scale(1.3)'" onmouseleave="this.style.transform='scale(1)'"></div>`,
				iconSize: [size, size],
				iconAnchor: [size / 2, size / 2],
			});

			const marker = L.marker([site.latitude!, site.longitude!], { icon })
				.bindTooltip(tooltipHtml(site, status), {
					permanent: false,
					direction: 'right',
					offset: [12, 0],
					className: 'site-status-tooltip',
				});

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

	$effect(() => {
		const _sites = filteredSites;
		const _status = siteStatus;
		if (el) initMap();
	});

	onDestroy(() => { map?.remove(); });
</script>

<div bind:this={el} style:height class="w-full rounded-md border border-brand-divider overflow-hidden"></div>

<style>
	:global(.site-status-tooltip) {
		background: rgba(17, 24, 39, 0.95);
		color: #f3f4f6;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 6px;
		padding: 8px 10px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
	}
	:global(.site-status-tooltip::before) {
		border-right-color: rgba(17, 24, 39, 0.95) !important;
	}
</style>
