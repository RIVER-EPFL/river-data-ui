import { useEffect, useMemo, useRef } from 'react';
import { useGetList } from 'react-admin';
import { useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

interface AlarmThresholdRecord {
  id: string;
  parameter_id: string;
}

const MARKER_COLORS = {
  green: '#4caf50',
  yellow: '#ff9800',
  grey: '#9e9e9e',
} as const;

export const SiteMap = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const navigate = useNavigate();

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

  const { data: alarmThresholds } = useGetList<AlarmThresholdRecord>(
    'alarm_thresholds',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
    },
  );

  // Build lookup: site_id -> count of site_parameters
  const paramCountBySite = useMemo(() => {
    const map = new Map<string, number>();
    if (!siteParameters) return map;
    for (const sp of siteParameters) {
      map.set(sp.site_id, (map.get(sp.site_id) ?? 0) + 1);
    }
    return map;
  }, [siteParameters]);

  // Build lookup: site_id -> has alarm thresholds configured
  // alarm_thresholds reference parameter_id; site_parameters link parameter to site
  const sitesWithAlarms = useMemo(() => {
    const result = new Set<string>();
    if (!alarmThresholds || !siteParameters) return result;
    const paramToSite = new Map<string, string>();
    for (const sp of siteParameters) {
      paramToSite.set(sp.id, sp.site_id);
    }
    for (const at of alarmThresholds) {
      const siteId = paramToSite.get(at.parameter_id);
      if (siteId) result.add(siteId);
    }
    return result;
  }, [alarmThresholds, siteParameters]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current).setView([46.5, 7.5], 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !sites) return;

    // Clear existing circle markers
    for (const m of markersRef.current) {
      map.removeLayer(m);
    }
    markersRef.current = [];

    const validSites = sites.filter(
      (s): s is SiteRecord & { latitude: number; longitude: number } =>
        s.latitude != null && s.longitude != null,
    );

    if (validSites.length === 0) return;

    const bounds: L.LatLngBoundsExpression = validSites.map(
      (s) => [s.latitude, s.longitude] as L.LatLngTuple,
    );

    validSites.forEach((site) => {
      const paramCount = paramCountBySite.get(site.id) ?? 0;
      const hasAlarms = sitesWithAlarms.has(site.id);

      // Color logic: yellow if alarm thresholds configured, green if has params, grey otherwise
      let color: string;
      if (paramCount === 0) {
        color = MARKER_COLORS.grey;
      } else if (hasAlarms) {
        color = MARKER_COLORS.yellow;
      } else {
        color = MARKER_COLORS.green;
      }

      const popupContent = [
        `<strong>${site.name}</strong>`,
        `<br/>Parameters: ${paramCount}`,
        hasAlarms ? '<br/>Alarm rules configured' : '',
      ].join('');

      const marker = L.circleMarker([site.latitude, site.longitude], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      })
        .addTo(map)
        .bindPopup(popupContent);

      marker.on('click', () => {
        navigate(`/admin/sites/${site.id}/show`);
      });

      markersRef.current.push(marker);
    });

    if (validSites.length > 1) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView([validSites[0].latitude, validSites[0].longitude], 12);
    }
  }, [sites, navigate, paramCountBySite, sitesWithAlarms]);

  return (
    <Box
      sx={{
        height: 400,
        width: '100%',
        borderRadius: 1,
        overflow: 'hidden',
        mb: 2,
      }}
    >
      <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
    </Box>
  );
};
