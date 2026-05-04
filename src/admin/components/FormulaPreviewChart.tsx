import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useGetList } from 'react-admin';
import { useAuthFetch } from '../hooks/useAuthFetch';
import {
  Box,
  TextField,
  MenuItem,
  CircularProgress,
  Alert,
  Typography,
} from '@mui/material';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { TimeRangeSlider } from './TimeRangeSlider';
import { useSiteDataRange } from '../hooks/useSiteDataRange';
import { tokens } from '../theme';

interface FormulaPreviewChartProps {
  formula: string;
  requiredVariables: string[];
  onSiteChange?: (siteId: string) => void;
}

interface PreviewResponse {
  site: { id: string; name: string };
  times: string[];
  source_parameters: Array<{ name: string; units: string; values: (number | null)[] }>;
  derived: { name: string; formula: string; values: (number | null)[]; errors: (string | null)[] };
}

const SOURCE_COLORS = tokens.dataViz;

export const FormulaPreviewChart: React.FC<FormulaPreviewChartProps> = ({
  formula,
  requiredVariables,
  onSiteChange,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [siteId, setSiteId] = useState<string>('');
  const [start, setStart] = useState<number>(() => Date.now() - 24 * 60 * 60 * 1000);
  const [end, setEnd] = useState<number>(Date.now);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string>('');

  const authFetch = useAuthFetch();
  const dataRange = useSiteDataRange(siteId ? [siteId] : []);

  const { data: sites } = useGetList('sites', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: allParameters } = useGetList('parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: allSiteParams } = useGetList('site_parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'id', order: 'ASC' },
  });

  // Compute which sites have ALL the required parameters
  const eligibleSiteIds = useMemo(() => {
    if (!allParameters || !allSiteParams || requiredVariables.length === 0) return null;

    const requiredParamIds = requiredVariables
      .map(v => allParameters.find(p => p.name === v)?.id as string | undefined)
      .filter((id): id is string => !!id);

    if (requiredParamIds.length === 0) return null;

    const siteParamMap = new Map<string, Set<string>>();
    for (const sp of allSiteParams) {
      const sid = sp.site_id as string;
      if (!siteParamMap.has(sid)) siteParamMap.set(sid, new Set());
      siteParamMap.get(sid)!.add(sp.parameter_id as string);
    }

    const eligible = new Set<string>();
    for (const [sid, paramIds] of siteParamMap) {
      if (requiredParamIds.every(pid => paramIds.has(pid))) {
        eligible.add(sid);
      }
    }
    return eligible;
  }, [allParameters, allSiteParams, requiredVariables]);

  const eligibleSites = useMemo(() => {
    if (!sites) return [];
    if (!eligibleSiteIds) return sites;
    return sites.filter(s => eligibleSiteIds.has(s.id as string));
  }, [sites, eligibleSiteIds]);

  // Auto-select first eligible site, or deselect if current is ineligible
  useEffect(() => {
    if (!eligibleSiteIds || !sites?.length) return;
    if (eligibleSiteIds.size === 0) {
      setSiteId('');
      return;
    }
    if (!siteId || !eligibleSiteIds.has(siteId)) {
      const first = sites.find(s => eligibleSiteIds.has(s.id as string));
      setSiteId(first ? (first.id as string) : '');
    }
  }, [eligibleSiteIds, sites]);

  // Notify parent of site changes
  useEffect(() => {
    onSiteChange?.(siteId);
  }, [siteId, onSiteChange]);

  const handleRangeChange = useCallback((s: number, e: number) => {
    setStart(s);
    setEnd(e);
  }, []);

  const fetchPreview = useCallback(async () => {
    if (!formula.trim() || requiredVariables.length === 0 || !siteId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await authFetch('/api/service/actions/preview_derived', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formula,
          site_id: siteId,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
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
        stroke: tokens.dataViz[0],
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
  }, [formula, requiredVariables, siteId, start, end, authFetch]);

  // Debounced fetch: immediate on site/range change, debounced on formula change
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
        const newWidth = chartRef.current.clientWidth;
        if (Math.abs(uplotRef.current.width - newWidth) > 4) {
          uplotRef.current.setSize({ width: newWidth, height: 300 });
        }
      }
    });

    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  const hasFormula = formula.trim() && requiredVariables.length > 0;

  return (
    <Box sx={{ mt: 2, width: '100%' }}>
      {!hasFormula && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Build a formula with at least one variable to see a live preview
        </Alert>
      )}
      {hasFormula && eligibleSiteIds?.size === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No sites have all required parameters ({requiredVariables.join(', ')})
        </Alert>
      )}
      {hasFormula && siteName && eligibleSites.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Preview using data from <strong>{siteName}</strong> — this is a preview, not stored data
        </Alert>
      )}

      {hasFormula && eligibleSites.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            label="Site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {eligibleSites.map((site) => (
              <MenuItem key={site.id} value={site.id}>
                {site.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      {siteId && (
        <>
          <TimeRangeSlider
            dataMin={dataRange.min}
            dataMax={dataRange.max}
            loading={dataRange.loading}
            start={start}
            end={end}
            onChange={handleRangeChange}
          />

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

          <div ref={chartRef} style={{ width: '100%', overflow: 'hidden' }} />
        </>
      )}
    </Box>
  );
};
