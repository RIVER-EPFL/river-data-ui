import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useGetList } from 'react-admin';
import { useKeycloak } from '../KeycloakContext';
import {
  Box,
  TextField,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Alert,
  Typography,
} from '@mui/material';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface FormulaPreviewChartProps {
  formula: string;
  requiredVariables: string[];
}

interface PreviewResponse {
  site: { id: string; name: string };
  times: string[];
  source_parameters: Array<{ name: string; units: string; values: (number | null)[] }>;
  derived: { name: string; formula: string; values: (number | null)[]; errors: (string | null)[] };
}

type TimeRange = '24h' | '7d' | '30d';

const TIME_RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const SOURCE_COLORS = [
  '#ff9800', '#4caf50', '#9c27b0', '#f44336', '#00bcd4',
  '#795548', '#607d8b', '#e91e63', '#3f51b5', '#009688',
];

export const FormulaPreviewChart: React.FC<FormulaPreviewChartProps> = ({
  formula,
  requiredVariables,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [siteId, setSiteId] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string>('');

  const keycloak = useKeycloak();

  const { data: sites } = useGetList('sites', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });

  // Auto-select first site for immediate preview
  useEffect(() => {
    if (!siteId && sites?.length) {
      setSiteId(sites[0].id as string);
    }
  }, [sites, siteId]);

  const fetchPreview = useCallback(async () => {
    if (!formula.trim() || requiredVariables.length === 0 || !siteId) return;

    setLoading(true);
    setError(null);

    const now = new Date();
    const start = new Date(now.getTime() - TIME_RANGE_MS[timeRange]);

    const headers: HeadersInit = keycloak?.token
      ? { 'Authorization': 'Bearer ' + keycloak.token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };

    try {
      const res = await fetch('/api/service/actions/preview_derived', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          formula,
          site_id: siteId,
          start: start.toISOString(),
          end: now.toISOString(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data: PreviewResponse = await res.json();
      setSiteName(data.site.name);

      if (!data.times?.length) {
        uplotRef.current?.destroy();
        uplotRef.current = null;
        setError('No data available for the selected site and time range.');
        return;
      }

      // Convert times to unix timestamps (seconds)
      const times = data.times.map((t) => new Date(t).getTime() / 1000);

      // Build series and data arrays for source parameters
      const sourceSeries: uPlot.Series[] = data.source_parameters.map((sp, i) => ({
        label: `${sp.name} (${sp.units})`,
        stroke: SOURCE_COLORS[i % SOURCE_COLORS.length],
        width: 1,
        points: { show: false },
      }));

      const sourceData = data.source_parameters.map((sp) =>
        sp.values.map((v) => v ?? undefined) as (number | undefined)[],
      );

      // Derived series (bold blue line)
      const derivedSeries: uPlot.Series = {
        label: `Derived: ${data.derived.name}`,
        stroke: '#2196f3',
        width: 3,
        points: { show: false },
      };

      const derivedData = data.derived.values.map((v) => v ?? undefined) as (number | undefined)[];

      const allData: uPlot.AlignedData = [
        times,
        ...sourceData,
        derivedData as (number | null | undefined)[],
      ];

      const opts: uPlot.Options = {
        width: chartRef.current?.clientWidth ?? 600,
        height: 300,
        series: [
          {},
          ...sourceSeries,
          derivedSeries,
        ],
        axes: [
          {},
          {
            size: 60,
          },
        ],
        cursor: {
          drag: { x: true, y: false },
        },
        scales: {
          x: { time: true },
        },
      };

      // Destroy previous instance
      uplotRef.current?.destroy();

      if (chartRef.current) {
        uplotRef.current = new uPlot(opts, allData, chartRef.current);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      uplotRef.current?.destroy();
      uplotRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [formula, requiredVariables, siteId, timeRange, keycloak]);

  // Debounced fetch: immediate on site/timeRange change, debounced on formula change
  useEffect(() => {
    if (!formula.trim() || requiredVariables.length === 0 || !siteId) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchPreview();
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [fetchPreview]);

  // Cleanup uPlot on unmount
  useEffect(() => {
    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, []);

  // Handle resize
  useEffect(() => {
    if (!chartRef.current) return;

    const observer = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 300,
        });
      }
    });

    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  // Don't render if formula is empty or has no variables
  if (!formula.trim() || requiredVariables.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mt: 2, width: '100%' }}>
      {siteName && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Preview using data from <strong>{siteName}</strong> — this is a preview, not stored data
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          select
          label="Site"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        >
          {(sites ?? []).map((site) => (
            <MenuItem key={site.id} value={site.id}>
              {site.name}
            </MenuItem>
          ))}
        </TextField>

        <ToggleButtonGroup
          value={timeRange}
          exclusive
          onChange={(_, v) => { if (v) setTimeRange(v); }}
          size="small"
        >
          <ToggleButton value="24h">24h</ToggleButton>
          <ToggleButton value="7d">7d</ToggleButton>
          <ToggleButton value="30d">30d</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading preview...
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <div ref={chartRef} style={{ width: '100%' }} />
    </Box>
  );
};
