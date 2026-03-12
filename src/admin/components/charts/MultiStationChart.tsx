import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useGetList } from 'react-admin';
import { useKeycloak } from '../../KeycloakContext';
import {
  Box,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Autocomplete,
  CircularProgress,
  Paper,
} from '@mui/material';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface ReadingsResponse {
  times: string[];
  parameters: Array<{
    id: string;
    name: string;
    type: string;
    units: string | null;
    values: Array<number | null>;
  }>;
}

type TimeRange = '24h' | '7d' | '30d' | 'custom';
type AggregationLevel = 'raw' | 'hourly' | 'daily' | 'weekly' | 'monthly';

interface SiteRecord {
  id: string;
  name: string;
}

interface ParameterRecord {
  id: string;
  name: string;
  type: string;
  units: string | null;
}

const COLORS = ['#2196f3', '#f44336', '#4caf50', '#ff9800'];

const TIME_RANGE_MS: Record<Exclude<TimeRange, 'custom'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const toLocalDatetime = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const AGGREGATION_OPTIONS: { value: AggregationLevel; label: string }[] = [
  { value: 'raw', label: 'Raw' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export const MultiStationChart: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const keycloak = useKeycloak();

  const [selectedSites, setSelectedSites] = useState<SiteRecord[]>([]);
  const [selectedParameter, setSelectedParameter] = useState<ParameterRecord | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [aggregation, setAggregation] = useState<AggregationLevel>('raw');
  const [loading, setLoading] = useState(false);
  const [customStart, setCustomStart] = useState<string>(() =>
    toLocalDatetime(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    toLocalDatetime(new Date()),
  );

  const { data: sitesData, isLoading: sitesLoading } = useGetList<SiteRecord>('sites', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: paramsData, isLoading: paramsLoading } = useGetList<ParameterRecord>('parameters', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'name', order: 'ASC' },
  });

  const sites = sitesData ?? [];
  const parameters = paramsData ?? [];

  const fetchData = useCallback(async () => {
    if (selectedSites.length === 0 || !selectedParameter) return;

    setLoading(true);

    let start: Date;
    let end: Date | undefined;
    if (timeRange === 'custom') {
      start = new Date(customStart);
      end = new Date(customEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        setLoading(false);
        return;
      }
    } else {
      const now = new Date();
      start = new Date(now.getTime() - TIME_RANGE_MS[timeRange]);
      end = now;
    }

    const headers: HeadersInit = keycloak?.token
      ? { Authorization: 'Bearer ' + keycloak.token }
      : {};

    try {
      // Fetch readings for each selected site in parallel
      const results = await Promise.all(
        selectedSites.map(async (site) => {
          let url: string;
          if (aggregation === 'raw') {
            url = `/api/service/sites/${site.id}/readings?start=${start.toISOString()}&page_size=10000&format=json`;
          } else {
            url = `/api/service/sites/${site.id}/aggregates/${aggregation}?start=${start.toISOString()}&format=json`;
          }
          if (end) {
            url += `&end=${end.toISOString()}`;
          }
          url += `&parameter_ids=${selectedParameter.id}`;

          const res = await fetch(url, { headers });
          if (!res.ok) throw new Error(`HTTP ${res.status} for site ${site.name}`);
          const data: ReadingsResponse = await res.json();
          return { site, data };
        }),
      );

      // Build aligned uPlot data: merge all time axes into a unified set
      // Each station maps to its own series
      const allTimeSets: Map<number, number[]> = new Map(); // timestamp -> array of values per station (indexed)

      const stationData: { site: SiteRecord; times: number[]; values: (number | null)[] }[] = [];

      for (const { site, data } of results) {
        const param = data.parameters?.find((p) => p.id === selectedParameter.id);
        if (!data.times?.length || !param) {
          stationData.push({ site, times: [], values: [] });
          continue;
        }
        const times = data.times.map((t) => Math.round(new Date(t).getTime() / 1000));
        stationData.push({ site, times, values: param.values });
        for (const t of times) {
          if (!allTimeSets.has(t)) allTimeSets.set(t, []);
        }
      }

      if (allTimeSets.size === 0) {
        uplotRef.current?.destroy();
        uplotRef.current = null;
        setLoading(false);
        return;
      }

      // Sort all unique timestamps
      const allTimes = Array.from(allTimeSets.keys()).sort((a, b) => a - b);
      const timeIndex = new Map(allTimes.map((t, i) => [t, i]));

      // Build per-station aligned arrays
      const seriesArrays: (number | null | undefined)[][] = selectedSites.map(() =>
        new Array(allTimes.length).fill(undefined),
      );

      for (let si = 0; si < stationData.length; si++) {
        const { times, values } = stationData[si];
        for (let i = 0; i < times.length; i++) {
          const idx = timeIndex.get(times[i]);
          if (idx !== undefined) {
            seriesArrays[si][idx] = values[i] ?? undefined;
          }
        }
      }

      const allData: uPlot.AlignedData = [allTimes, ...seriesArrays];

      const series: uPlot.Series[] = [
        {}, // x-axis
        ...selectedSites.map((site, i) => ({
          label: site.name,
          stroke: COLORS[i % COLORS.length],
          width: 2,
          points: { show: false },
        })),
      ];

      const units = selectedParameter.units;

      const opts: uPlot.Options = {
        width: chartRef.current?.clientWidth ?? 800,
        height: 400,
        series,
        axes: [
          {},
          {
            label: units ?? '',
            size: 60,
          },
        ],
        cursor: {
          drag: { x: true, y: false },
        },
        scales: {
          x: { time: true },
        },
        legend: {
          show: true,
        },
      };

      uplotRef.current?.destroy();

      if (chartRef.current) {
        uplotRef.current = new uPlot(opts, allData, chartRef.current);
      }
    } catch (err) {
      console.error('Failed to fetch comparison data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSites, selectedParameter, timeRange, aggregation, customStart, customEnd, keycloak]);

  useEffect(() => {
    fetchData();
    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [fetchData]);

  // Handle resize
  useEffect(() => {
    if (!chartRef.current) return;

    const observer = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 400,
        });
      }
    });

    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <Box>
      {/* Controls */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Autocomplete
            multiple
            options={sites}
            getOptionLabel={(option) => option.name}
            value={selectedSites}
            onChange={(_, value) => setSelectedSites(value.slice(0, 4))}
            loading={sitesLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Stations (max 4)"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {sitesLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            sx={{ minWidth: 300, flex: 1 }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            getOptionDisabled={() => selectedSites.length >= 4}
          />

          <Autocomplete
            options={parameters}
            getOptionLabel={(option) => `${option.name}${option.units ? ` (${option.units})` : ''}`}
            value={selectedParameter}
            onChange={(_, value) => setSelectedParameter(value)}
            loading={paramsLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Parameter"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {paramsLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            sx={{ minWidth: 250 }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <ToggleButtonGroup
            value={timeRange}
            exclusive
            onChange={(_, v) => { if (v) setTimeRange(v); }}
            size="small"
          >
            <ToggleButton value="24h">24h</ToggleButton>
            <ToggleButton value="7d">7d</ToggleButton>
            <ToggleButton value="30d">30d</ToggleButton>
            <ToggleButton value="custom">Custom</ToggleButton>
          </ToggleButtonGroup>

          {timeRange === 'custom' && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                type="datetime-local"
                size="small"
                label="Start"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 200 }}
              />
              <TextField
                type="datetime-local"
                size="small"
                label="End"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ width: 200 }}
              />
            </Box>
          )}

          <ToggleButtonGroup
            value={aggregation}
            exclusive
            onChange={(_, v) => { if (v) setAggregation(v); }}
            size="small"
          >
            {AGGREGATION_OPTIONS.map((opt) => (
              <ToggleButton key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Paper>

      {/* Chart area */}
      <Paper sx={{ p: 2 }}>
        {selectedSites.length === 0 || !selectedParameter ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            Select at least one station and a parameter to compare
          </Typography>
        ) : loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4, gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Loading chart data...
            </Typography>
          </Box>
        ) : null}

        {/* Legend showing station colors */}
        {selectedSites.length > 0 && selectedParameter && !loading && (
          <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
            {selectedSites.map((site, i) => (
              <Box key={site.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  sx={{
                    width: 12,
                    height: 3,
                    backgroundColor: COLORS[i % COLORS.length],
                    borderRadius: 1,
                  }}
                />
                <Typography variant="caption">{site.name}</Typography>
              </Box>
            ))}
          </Box>
        )}

        <div ref={chartRef} style={{ width: '100%' }} />
      </Paper>
    </Box>
  );
};
