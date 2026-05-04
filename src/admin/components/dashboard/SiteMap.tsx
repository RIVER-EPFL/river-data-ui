import { useEffect, useRef, useCallback } from 'react';
import { useGetList } from 'react-admin';
import { Box } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface SiteRecord {
  id: string;
  name: string;
  project_id: string;
  latitude: number | null;
  longitude: number | null;
}

const isValidCoord = (s: SiteRecord): s is SiteRecord & { latitude: number; longitude: number } =>
  s.latitude != null && s.longitude != null &&
  s.latitude >= -90 && s.latitude <= 90 &&
  s.longitude >= -180 && s.longitude <= 180;

const MARKER_COLORS = {
  green: '#4caf50',
} as const;

interface SiteMapProps {
  onSiteClick?: (siteId: string, site: { name: string; project_id: string }) => void;
  selectedSiteId?: string | null;
  /** Called when sites load, with the count of sites missing valid coordinates */
  onMissingCount?: (count: number) => void;
  /** When set, only show sites belonging to this project and zoom to fit them */
  filterProjectId?: string | null;
}

export const SiteMap = ({ onSiteClick, selectedSiteId, onMissingCount, filterProjectId }: SiteMapProps) => {
  const mapInstance = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onSiteClickRef = useRef(onSiteClick);
  onSiteClickRef.current = onSiteClick;
  const hasFitBounds = useRef(false);

  // Callback ref: initializes Leaflet map when DOM element mounts.
  // Unlike useEffect, this is NOT replayed by StrictMode.
  const mapRef = useCallback((div: HTMLDivElement | null) => {
    if (!div) {
      // Element unmounting (StrictMode or navigation) — clean up dead map
      mapInstance.current?.remove();
      mapInstance.current = null;
      clusterGroupRef.current = null;
      markersRef.current = new Map();
      hasFitBounds.current = false;
      return;
    }
    if (!mapInstance.current) {
      mapInstance.current = L.map(div, { center: [46.5, 7.5], zoom: 8, fadeAnimation: false });

      const swisstopo = L.tileLayer(
        'https://wmts20.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
        { attribution: '&copy; <a href="https://www.swisstopo.admin.ch/">SwissTopo</a>', maxZoom: 18 },
      );
      const swissAerial = L.tileLayer(
        'https://wmts20.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
        { attribution: '&copy; <a href="https://www.swisstopo.admin.ch/">SwissTopo</a>', maxZoom: 18 },
      );
      const osm = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 },
      );

      osm.addTo(mapInstance.current);
      L.control.layers({
        'SwissTopo': swisstopo,
        'SwissTopo Aerial': swissAerial,
        'OpenStreetMap': osm,
      }).addTo(mapInstance.current);
    }
  }, []);

  const { data: sites } = useGetList<SiteRecord>('sites', {
    pagination: { page: 1, perPage: 10000 },
    sort: { field: 'name', order: 'ASC' },
  });

  // Notify Leaflet when container resizes (e.g. collapse/expand)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const el = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    return () => observer.disconnect();
  });

  const prevFilterRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !sites) return;

    // Remove previous cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }

    const filtered = filterProjectId
      ? sites.filter((s) => s.project_id === filterProjectId)
      : sites;
    const validSites = filtered.filter(isValidCoord);

    if (validSites.length === 0) return;

    const bounds: L.LatLngBoundsExpression = validSites.map(
      (s) => [s.latitude, s.longitude] as L.LatLngTuple,
    );

    const clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div class="site-cluster" style="background:${MARKER_COLORS.green}"><span>${count}</span></div>`,
          className: 'site-cluster-icon',
          iconSize: L.point(40, 40),
        });
      },
    });

    const newMarkers = new Map<string, L.Marker>();

    validSites.forEach((site) => {
      const icon = L.divIcon({
        html: `<div class="site-marker" style="background:${MARKER_COLORS.green}"></div>`,
        className: 'site-marker-icon',
        iconSize: L.point(24, 24),
        iconAnchor: L.point(12, 12),
        tooltipAnchor: L.point(14, 0),
      });

      const marker = L.marker([site.latitude, site.longitude], { icon })
        .bindTooltip(site.name, {
          permanent: true,
          direction: 'right',
          className: 'site-label',
        })
        .on('click', () => onSiteClickRef.current?.(site.id, { name: site.name, project_id: site.project_id }));

      newMarkers.set(site.id, marker);
      clusterGroup.addLayer(marker);
    });

    markersRef.current = newMarkers;

    map.addLayer(clusterGroup);
    clusterGroupRef.current = clusterGroup;

    const filterChanged = prevFilterRef.current !== filterProjectId;
    prevFilterRef.current = filterProjectId;

    if (!hasFitBounds.current || filterChanged) {
      if (validSites.length > 1) {
        map.fitBounds(bounds, { padding: [50, 50], animate: filterChanged });
      } else {
        map.setView([validSites[0].latitude, validSites[0].longitude], 14, { animate: filterChanged });
      }
      hasFitBounds.current = true;
    }
  }, [sites, filterProjectId]);

  // Update active marker styling when selection changes
  useEffect(() => {
    for (const [siteId, marker] of markersRef.current) {
      const el = (marker as L.Marker).getElement();
      if (!el) continue;
      if (siteId === selectedSiteId) {
        el.classList.add('site-marker-active');
      } else {
        el.classList.remove('site-marker-active');
      }
    }
  }, [selectedSiteId]);

  useEffect(() => {
    if (!sites) return;
    const filtered = filterProjectId
      ? sites.filter((s) => s.project_id === filterProjectId)
      : sites;
    onMissingCount?.(filtered.length - filtered.filter(isValidCoord).length);
  }, [sites, filterProjectId, onMissingCount]);

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
        borderRadius: 1,
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        .site-marker-icon {
          background: transparent !important;
          border: none !important;
        }
        .site-marker {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 0 0 2px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.4);
          transition: transform 0.2s ease;
        }
        .site-marker-active .site-marker {
          transform: scale(1.4);
          border-color: #fff;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.9), 0 0 12px 4px rgba(37,99,235,0.5), 0 2px 8px rgba(0,0,0,0.4);
        }
        .site-marker-active {
          z-index: 1000 !important;
        }
        @keyframes site-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(37,99,235,0.9), 0 0 12px 4px rgba(37,99,235,0.5); }
          50% { box-shadow: 0 0 0 5px rgba(37,99,235,0.6), 0 0 20px 8px rgba(37,99,235,0.3); }
        }
        .site-marker-active .site-marker {
          animation: site-pulse 2s ease-in-out infinite;
        }
        .site-cluster-icon {
          background: transparent !important;
          border: none !important;
        }
        .site-cluster {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 0 0 2px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .site-cluster span {
          color: white;
          font-weight: 700;
          font-size: 14px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        .site-label {
          background: rgba(255,255,255,0.92) !important;
          border: 1px solid rgba(0,0,0,0.2) !important;
          border-radius: 4px !important;
          padding: 2px 6px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          color: #333 !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3) !important;
          white-space: nowrap !important;
        }
        .site-label::before {
          border-right-color: rgba(0,0,0,0.2) !important;
        }
      `}</style>
      <div ref={mapRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
    </Box>
  );
};
