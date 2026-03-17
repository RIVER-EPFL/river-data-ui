import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useGetList } from 'react-admin';
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { AlarmSummaryResponse } from '../../dataProvider';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

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

interface SyncState {
  site_parameter_id: string;
  last_data_time: string | null;
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
}

export const SiteMap = ({ onSiteClick }: SiteMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const navigate = useNavigate();
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
  const [siteLastReading, setSiteLastReading] = useState<Map<string, string>>(new Map());

  const fetchAlarmAndSyncData = useCallback(async () => {
    try {
      const [alarmRes, syncRes] = await Promise.all([
        dataProvider.getAlarmSummary(),
        dataProvider.getSyncState() as Promise<{ data: SyncState[] }>,
      ]);

      setAlarmSummary(alarmRes.data);

      // Build site_parameter_id -> site_id mapping
      if (siteParameters) {
        const spToSite = new Map<string, string>();
        for (const sp of siteParameters) {
          spToSite.set(sp.id, sp.site_id);
        }

        // Group by site: find max last_data_time per site
        const lastReadingMap = new Map<string, string>();
        for (const s of syncRes.data) {
          const siteId = spToSite.get(s.site_parameter_id);
          if (!siteId || !s.last_data_time) continue;
          const existing = lastReadingMap.get(siteId);
          if (!existing || s.last_data_time > existing) {
            lastReadingMap.set(siteId, s.last_data_time);
          }
        }
        setSiteLastReading(lastReadingMap);
      }
    } catch (err) {
      console.error('Failed to fetch alarm/sync data for map:', err);
    }
  }, [dataProvider, siteParameters]);

  useEffect(() => {
    if (siteParameters) fetchAlarmAndSyncData();
  }, [siteParameters, fetchAlarmAndSyncData]);

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

    mapInstance.current = L.map(mapRef.current).setView([46.5, 7.5], 8);

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

    swisstopo.addTo(mapInstance.current);

    L.control.layers({
      'SwissTopo': swisstopo,
      'SwissTopo Aerial': swissAerial,
      'OpenStreetMap': osm,
    }).addTo(mapInstance.current);

    // Handle popup link clicks with React Router
    const container = mapRef.current;
    const handlePopupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest<HTMLElement>('a[data-navigate]');
      if (link) {
        e.preventDefault();
        const path = link.getAttribute('data-navigate');
        if (path) navigate(path);
      }
    };
    container.addEventListener('click', handlePopupClick);

    return () => {
      container.removeEventListener('click', handlePopupClick);
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, [navigate]);

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
      const alarms = siteAlarmMap.get(site.id);
      const lastReading = siteLastReading.get(site.id);

      // Color based on active alarm state
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

      const alarmTotal = alarms ? alarms.warning + alarms.alarm : 0;

      const popupLines = [
        `<strong style="font-size:14px">${site.name}</strong>`,
        `<br/><span style="color:#666">Parameters: ${paramCount}</span>`,
      ];
      if (lastReading) {
        popupLines.push(`<br/><span style="color:#666">Last reading: ${formatRelativeTime(lastReading)}</span>`);
      }
      if (alarmTotal > 0) {
        popupLines.push(
          `<br/><span style="color:${alarms!.alarm > 0 ? MARKER_COLORS.red : MARKER_COLORS.orange}; font-weight:600">Active alarms: ${alarmTotal}</span>`,
        );
      }
      popupLines.push(
        `<br/><div style="display:flex;gap:6px;margin-top:8px">` +
          `<a data-navigate="/admin/sites/${site.id}/show" style="padding:4px 10px;background:#1976d2;color:white;border-radius:4px;text-decoration:none;font-size:12px;cursor:pointer">View Station</a>` +
          `<a data-navigate="/admin/sites/${site.id}/show?export=true" style="padding:4px 10px;background:#2e7d32;color:white;border-radius:4px;text-decoration:none;font-size:12px;cursor:pointer">Export</a>` +
        `</div>`,
      );

      const marker = L.circleMarker([site.latitude, site.longitude], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      })
        .addTo(map)
        .bindPopup(popupLines.join(''));

      markersRef.current.push(marker);
    });

    if (validSites.length > 1) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      map.setView([validSites[0].latitude, validSites[0].longitude], 12);
    }
  }, [sites, paramCountBySite, siteAlarmMap, siteLastReading]);

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
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: item.color,
                border: '1.5px solid white',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
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
