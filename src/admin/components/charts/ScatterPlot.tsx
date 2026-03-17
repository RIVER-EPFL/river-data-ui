import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  MenuItem,
  CircularProgress,
  Alert,
  FormControlLabel,
  Switch,
} from '@mui/material';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { TimeRangeSlider } from '../TimeRangeSlider';
import { useSiteDataRange } from '../../hooks/useSiteDataRange';

export interface ScatterParameter {
  id: string;
  name: string;
  units: string | null;
}

interface ScatterPlotProps {
  siteId: string;
  parameters: ScatterParameter[];
}

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

/** Compute linear regression: y = slope * x + intercept, plus R-squared. */
function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  let ssTot = 0,
    ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - yMean) ** 2;
    ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

/** uPlot plugin: hover tooltip showing timestamp + both axis values. */
const tooltipPlugin = (
  timestampsRef: React.MutableRefObject<string[]>,
  xLabel: string,
  yLabel: string,
): uPlot.Plugin => {
  let tooltip: HTMLDivElement;

  return {
    hooks: {
      init: [
        (u: uPlot) => {
          tooltip = document.createElement('div');
          tooltip.style.cssText =
            'position:absolute;display:none;background:rgba(0,0,0,0.85);color:#fff;' +
            'padding:8px 12px;border-radius:4px;font-size:12px;pointer-events:none;' +
            'z-index:100;white-space:nowrap;line-height:1.5;';
          u.over.appendChild(tooltip);
        },
      ],
      setCursor: [
        (u: uPlot) => {
          const idx = u.cursor.idx;
          if (idx == null || idx < 0 || u.data[0][idx] == null || u.data[1][idx] == null) {
            tooltip.style.display = 'none';
            return;
          }
          const xVal = u.data[0][idx];
          const yVal = u.data[1][idx];
          const ts = timestampsRef.current[idx] ?? '';
          tooltip.innerHTML =
            `<b>${ts}</b><br/>${xLabel}: ${xVal?.toFixed(3)}<br/>${yLabel}: ${yVal?.toFixed(3)}`;
          tooltip.style.display = 'block';
          const left = u.cursor.left ?? 0;
          const top = u.cursor.top ?? 0;
          const overRight = left + 200 > u.over.clientWidth;
          tooltip.style.left = (overRight ? left - 160 : left + 12) + 'px';
          tooltip.style.top = Math.max(0, top - 40) + 'px';
        },
      ],
    },
  };
};

export const ScatterPlot: React.FC<ScatterPlotProps> = ({ siteId, parameters }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const timestampsRef = useRef<string[]>([]);

  const [xParamId, setXParamId] = useState('');
  const [yParamId, setYParamId] = useState('');
  const [start, setStart] = useState<number>(() => Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [end, setEnd] = useState<number>(Date.now);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rSquared, setRSquared] = useState<number | null>(null);
  const [showRegression, setShowRegression] = useState(true);
  const [pointCount, setPointCount] = useState(0);
  const authFetch = useAuthFetch();
  const dataRange = useSiteDataRange([siteId]);

  const xParam = parameters.find((p) => p.id === xParamId);
  const yParam = parameters.find((p) => p.id === yParamId);

  const handleRangeChange = useCallback((s: number, e: number) => {
    setStart(s);
    setEnd(e);
  }, []);

  const fetchAndPlot = useCallback(async () => {
    if (!xParamId || !yParamId || !chartRef.current) return;

    setLoading(true);
    setError(null);
    setRSquared(null);
    setPointCount(0);

    try {
      let url =
        `/api/service/sites/${siteId}/readings` +
        `?start=${new Date(start).toISOString()}&page_size=10000&format=json` +
        `&parameter_ids=${xParamId},${yParamId}` +
        `&end=${new Date(end).toISOString()}`;

      const res = await authFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: ReadingsResponse = await res.json();
      const xData = data.parameters?.find((p) => p.id === xParamId);
      const yData = data.parameters?.find((p) => p.id === yParamId);

      if (!data.times?.length || !xData || !yData) {
        uplotRef.current?.destroy();
        uplotRef.current = null;
        setError('No data available for the selected parameters and time range.');
        return;
      }

      // Pair values by timestamp index, filtering out nulls
      const paired: Array<{ ts: string; x: number; y: number }> = [];
      for (let i = 0; i < data.times.length; i++) {
        const xv = xData.values[i];
        const yv = yData.values[i];
        if (xv != null && yv != null) {
          paired.push({ ts: data.times[i], x: xv, y: yv });
        }
      }

      if (paired.length === 0) {
        uplotRef.current?.destroy();
        uplotRef.current = null;
        setError('No overlapping data points for the selected parameters.');
        return;
      }

      // uPlot requires x-axis data sorted ascending
      paired.sort((a, b) => a.x - b.x);

      const xs = paired.map((p) => p.x);
      const ys = paired.map((p) => p.y);
      timestampsRef.current = paired.map((p) => new Date(p.ts).toLocaleString());
      setPointCount(paired.length);

      // Regression
      const reg = linearRegression(xs, ys);
      if (reg) setRSquared(reg.rSquared);

      // Build uPlot data and series
      const plotData: uPlot.AlignedData = [xs, ys];
      const xLabel = xParam
        ? `${xParam.name}${xParam.units ? ` (${xParam.units})` : ''}`
        : 'X';
      const yLabel = yParam
        ? `${yParam.name}${yParam.units ? ` (${yParam.units})` : ''}`
        : 'Y';

      const series: uPlot.Series[] = [
        { label: xLabel },
        {
          label: yLabel,
          stroke: '#2196f3',
          width: 0,
          paths: () => null,
          points: { show: true, size: 5, fill: '#2196f3' },
        },
      ];

      if (showRegression && reg) {
        const regY = xs.map((x) => reg.slope * x + reg.intercept);
        plotData.push(regY);
        series.push({
          label: `Regression (R\u00B2=${reg.rSquared.toFixed(4)})`,
          stroke: 'rgba(244, 67, 54, 0.8)',
          width: 2,
          dash: [6, 3],
          points: { show: false },
        });
      }

      const opts: uPlot.Options = {
        width: chartRef.current.clientWidth,
        height: 400,
        plugins: [tooltipPlugin(timestampsRef, xLabel, yLabel)],
        series,
        scales: {
          x: { time: false },
        },
        axes: [
          { label: xLabel, size: 40 },
          { label: yLabel, size: 60 },
        ],
        cursor: {
          drag: { x: true, y: true },
        },
        legend: { show: true },
      };

      uplotRef.current?.destroy();
      uplotRef.current = new uPlot(opts, plotData, chartRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scatter data');
    } finally {
      setLoading(false);
    }
  }, [siteId, xParamId, yParamId, start, end, authFetch, showRegression, xParam, yParam]);

  useEffect(() => {
    fetchAndPlot();
    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [fetchAndPlot]);

  // Handle container resize
  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({ width: chartRef.current.clientWidth, height: 400 });
      }
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'center' }}>
          <TextField
            select
            label="X Axis"
            value={xParamId}
            onChange={(e) => setXParamId(e.target.value)}
            size="small"
            sx={{ minWidth: 180 }}
          >
            {parameters.map((p) => (
              <MenuItem key={p.id} value={p.id} disabled={p.id === yParamId}>
                {p.name} {p.units ? `(${p.units})` : ''}
              </MenuItem>
            ))}
          </TextField>

          <Typography variant="body2" color="text.secondary">
            vs
          </Typography>

          <TextField
            select
            label="Y Axis"
            value={yParamId}
            onChange={(e) => setYParamId(e.target.value)}
            size="small"
            sx={{ minWidth: 180 }}
          >
            {parameters.map((p) => (
              <MenuItem key={p.id} value={p.id} disabled={p.id === xParamId}>
                {p.name} {p.units ? `(${p.units})` : ''}
              </MenuItem>
            ))}
          </TextField>

          <FormControlLabel
            control={
              <Switch
                checked={showRegression}
                onChange={(e) => setShowRegression(e.target.checked)}
                size="small"
              />
            }
            label="Regression"
          />
        </Box>

        <TimeRangeSlider
          dataMin={dataRange.min}
          dataMax={dataRange.max}
          loading={dataRange.loading}
          start={start}
          end={end}
          onChange={handleRangeChange}
        />

        {rSquared !== null && (
          <Box sx={{ display: 'flex', gap: 3, mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              R&sup2; = <b>{rSquared.toFixed(4)}</b>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {pointCount} points
            </Typography>
          </Box>
        )}

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              Loading scatter data...
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="info" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}

        {(!xParamId || !yParamId) && !error && (
          <Alert severity="info">Select X and Y axis parameters to generate scatter plot.</Alert>
        )}

        <div ref={chartRef} style={{ width: '100%' }} />
      </CardContent>
    </Card>
  );
};
