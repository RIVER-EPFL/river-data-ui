import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useGetList } from 'react-admin';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { AlarmSummaryResponse } from '../../dataProvider';

interface SiteRecord {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface SiteParameterRecord {
  id: string;
  site_id: string;
  is_active: boolean;
}

const MARKER_COLORS = {
  red: '#d32f2f',
  orange: '#ff9800',
  green: '#4caf50',
  grey: '#9e9e9e',
} as const;

const LEGEND_ITEMS = [
  { color: MARKER_COLORS.red, label: 'Alarm' },
  { color: MARKER_COLORS.orange, label: 'Warning' },
  { color: MARKER_COLORS.green, label: 'Healthy' },
  { color: MARKER_COLORS.grey, label: 'No data' },
];

interface SiteMapProps {
  onSiteClick?: (siteId: string) => void;
  selectedSiteId?: string | null;
}

export const SiteMap = ({ onSiteClick, selectedSiteId }: SiteMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onSiteClickRef = useRef(onSiteClick);
  onSiteClickRef.current = onSiteClick;
  const hasFitBounds = useRef(false);
  const dataProvider = useRiverDataProvider();

  const { data: sites } = useGetList<SiteRecord>('sites', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: siteParameters } = useGetList<SiteParameterRecord>(
    'site_parameters',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
    },
  );

  const [alarmSummary, setAlarmSummary] = useState<AlarmSummaryResponse | null>(null);

  const fetchAlarmData = useCallback(async () => {
    try {
      const alarmRes = await dataProvider.getAlarmSummary();
      setAlarmSummary(alarmRes.data);
    } catch (err) {
      console.error('Failed to fetch alarm data for map:', err);
    }
  }, [dataProvider]);

  useEffect(() => {
    fetchAlarmData();
  }, [fetchAlarmData]);

  // Build lookups from alarm summary
  const siteAlarmMap = useMemo(() => {
    const map = new Map<string, { warning: number; alarm: number }>();
    if (!alarmSummary) return map;
    for (const site of alarmSummary.by_site) {
      map.set(site.site_id, {
        warning: site.warning_count,
        alarm: site.alarm_count,
      });
    }
    return map;
  }, [alarmSummary]);

  // Build lookup: site_id -> param count
  const paramCountBySite = useMemo(() => {
    const map = new Map<string, number>();
    if (!siteParameters) return map;
    for (const sp of siteParameters) {
      map.set(sp.site_id, (map.get(sp.site_id) ?? 0) + 1);
    }
    return map;
  }, [siteParameters]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current, { center: [46.5, 7.5], zoom: 8, fadeAnimation: false });

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

    swissAerial.addTo(mapInstance.current);

    L.control.layers({
      'SwissTopo': swisstopo,
      'SwissTopo Aerial': swissAerial,
      'OpenStreetMap': osm,
    }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !sites) return;

    // Remove previous cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }

    const validSites = sites.filter(
      (s): s is SiteRecord & { latitude: number; longitude: number } =>
        s.latitude != null && s.longitude != null,
    );

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
        const children = cluster.getAllChildMarkers();
        const count = children.length;
        // Worst-status color for cluster: red > orange > green > grey
        let worstColor = MARKER_COLORS.grey;
        for (const child of children) {
          const c = (child.options as { statusColor?: string }).statusColor;
          if (c === MARKER_COLORS.red) { worstColor = MARKER_COLORS.red; break; }
          if (c === MARKER_COLORS.orange) worstColor = MARKER_COLORS.orange;
          if (c === MARKER_COLORS.green && worstColor === MARKER_COLORS.grey) worstColor = MARKER_COLORS.green;
        }
        return L.divIcon({
          html: `<div class="site-cluster" style="background:${worstColor}"><span>${count}</span></div>`,
          className: 'site-cluster-icon',
          iconSize: L.point(40, 40),
        });
      },
    });

    const newMarkers = new Map<string, L.Marker>();

    validSites.forEach((site) => {
      const paramCount = paramCountBySite.get(site.id) ?? 0;
      const alarms = siteAlarmMap.get(site.id);

      let color: string;
      if (paramCount === 0) {
        color = MARKER_COLORS.grey;
      } else if (alarms?.alarm) {
        color = MARKER_COLORS.red;
      } else if (alarms?.warning) {
        color = MARKER_COLORS.orange;
      } else {
        color = MARKER_COLORS.green;
      }

      const icon = L.divIcon({
        html: `<div class="site-marker" style="background:${color}"></div>`,
        className: 'site-marker-icon',
        iconSize: L.point(24, 24),
        iconAnchor: L.point(12, 12),
        tooltipAnchor: L.point(14, 0),
      });

      const marker = L.marker([site.latitude, site.longitude], {
        icon,
        statusColor: color,
      } as L.MarkerOptions & { statusColor: string })
        .bindTooltip(site.name, {
          permanent: true,
          direction: 'right',
          className: 'site-label',
        })
        .on('click', () => onSiteClickRef.current?.(site.id));

      newMarkers.set(site.id, marker);
      clusterGroup.addLayer(marker);
    });

    markersRef.current = newMarkers;

    map.addLayer(clusterGroup);
    clusterGroupRef.current = clusterGroup;

    if (!hasFitBounds.current) {
      if (validSites.length > 1) {
        map.fitBounds(bounds, { padding: [50, 50], animate: false });
      } else {
        map.setView([validSites[0].latitude, validSites[0].longitude], 12, { animate: false });
      }
      hasFitBounds.current = true;
    }
  }, [sites, paramCountBySite, siteAlarmMap]);

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

  const missingCount = sites
    ? sites.length - sites.filter((s) => s.latitude != null && s.longitude != null).length
    : 0;

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
      {/* Map legend */}
      <Box
        sx={{
          position: 'absolute',
          bottom: missingCount > 0 ? 40 : 12,
          right: 12,
          bgcolor: 'rgba(255,255,255,0.92)',
          borderRadius: 1,
          px: 1.5,
          py: 1,
          zIndex: 1000,
          boxShadow: 1,
        }}
      >
        {LEGEND_ITEMS.map((item) => (
          <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: item.color,
                border: '2px solid white',
                boxShadow: '0 0 0 1.5px rgba(0,0,0,0.3)',
                flexShrink: 0,
              }}
            />
            <Typography variant="caption" sx={{ lineHeight: 1.2 }}>
              {item.label}
            </Typography>
          </Box>
        ))}
      </Box>
      {/* Missing coordinates notice */}
      {missingCount > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            bgcolor: 'rgba(255,255,255,0.92)',
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
            zIndex: 1000,
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {missingCount} site{missingCount > 1 ? 's' : ''} without coordinates (edit in Sites)
          </Typography>
        </Box>
      )}
    </Box>
  );
};
