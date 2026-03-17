import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  Collapse,
  IconButton,
  InputLabel,
  TextField,
  Tooltip,
  Checkbox,
  Select,
  MenuItem,
  FormControl,
  Popover,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FlagIcon from '@mui/icons-material/Flag';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { StatisticsPanel, type ChartData } from './StatisticsPanel';
import {
  type AnnotationData,
  ANNOTATION_CATEGORIES,
  annotationBandsPlugin,
  annotationInteractionPlugin,
} from './annotationPlugins';
import { TimeRangeSlider } from '../../components/TimeRangeSlider';
import { useSiteDataRange } from '../../hooks/useSiteDataRange';
import { resolveAggregation as resolveAggregationAuto } from '../../utils/timeRange';
import type { ReadingsResponse, AggregatesResponse } from '../../hooks/useSiteChartData';

interface AlarmThreshold {
  warning_min: number | null;
  warning_max: number | null;
  alarm_min: number | null;
  alarm_max: number | null;
}

interface ParameterChartProps {
  siteId: string;
  parameterId: string;
  parameterName: string;
  units: string | null;
  threshold?: AlarmThreshold;
  defaultExpanded?: boolean;
  /** When provided, use external time range (shared mode) — no per-chart slider or collapse */
  externalStart?: number;
  externalEnd?: number;
  /** uPlot cursor sync key for synchronized crosshairs across charts */
  syncKey?: string;
  /** Pre-fetched data from parent (skips HTTP when provided) */
  prefetchedData?: ReadingsResponse | AggregatesResponse | null;
  prefetchedIsAggregate?: boolean;
  prefetchedAnnotations?: AnnotationData[];
  prefetchedGrabData?: ReadingsResponse | null;
  /** Called after a mutation (annotation/flag) so parent can refetch shared data */
  onDataMutated?: () => void;
}

type AggregationLevel = 'auto' | 'raw' | 'hourly' | 'daily' | 'weekly' | 'monthly';

/**
 * uPlot plugin that draws filled alarm/warning bands behind the data series.
 * - Alarm zone (red): beyond alarm_min / alarm_max to chart edge
 * - Warning zone (orange): between warning and alarm thresholds
 */
const thresholdBandsPlugin = (
  threshold: AlarmThreshold,
  showBands: boolean,
): uPlot.Plugin => ({
  hooks: {
    draw: [
      (u: uPlot) => {
        if (!showBands) return;

        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;
        const yScale = u.scales.y;
        if (yScale.min == null || yScale.max == null) return;

        ctx.save();

        // Convert a Y-axis value to a canvas pixel coordinate
        const valToY = (val: number): number => u.valToPos(val, 'y', true);

        const chartTop = top;
        const chartBot = top + height;

        // Clamp a pixel Y to the chart area
        const clampY = (y: number): number =>
          Math.max(chartTop, Math.min(chartBot, y));

        // --- Alarm zones (red, beyond alarm thresholds) ---
        ctx.fillStyle = 'rgba(244, 67, 54, 0.12)';
        if (threshold.alarm_max != null) {
          const y = clampY(valToY(threshold.alarm_max));
          if (y > chartTop) {
            ctx.fillRect(left, chartTop, width, y - chartTop);
          }
        }
        if (threshold.alarm_min != null) {
          const y = clampY(valToY(threshold.alarm_min));
          if (y < chartBot) {
            ctx.fillRect(left, y, width, chartBot - y);
          }
        }

        // --- Warning zones (orange, between warning and alarm thresholds) ---
        ctx.fillStyle = 'rgba(255, 152, 0, 0.12)';

        // Upper warning band: between warning_max and alarm_max
        if (threshold.warning_max != null) {
          const warnY = clampY(valToY(threshold.warning_max));
          const upperBound =
            threshold.alarm_max != null
              ? clampY(valToY(threshold.alarm_max))
              : chartTop;
          if (warnY > upperBound) {
            ctx.fillRect(left, upperBound, width, warnY - upperBound);
          }
        }

        // Lower warning band: between alarm_min and warning_min
        if (threshold.warning_min != null) {
          const warnY = clampY(valToY(threshold.warning_min));
          const lowerBound =
            threshold.alarm_min != null
              ? clampY(valToY(threshold.alarm_min))
              : chartBot;
          if (lowerBound > warnY) {
            ctx.fillRect(left, warnY, width, lowerBound - warnY);
          }
        }

        ctx.restore();
      },
    ],
  },
});

/**
 * uPlot plugin that draws a semi-transparent fill between min and max series
 * for aggregate data. Expects series indices: 1=avg, 2=min, 3=max.
 */
const minMaxBandPlugin = (
  minIdx: number,
  maxIdx: number,
): uPlot.Plugin => ({
  hooks: {
    draw: [
      (u: uPlot) => {
        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;

        const minData = u.data[minIdx];
        const maxData = u.data[maxIdx];
        const xData = u.data[0];
        if (!minData || !maxData || !xData) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        ctx.fillStyle = 'rgba(33, 150, 243, 0.12)';
        ctx.beginPath();

        // Trace max line forward
        let started = false;
        for (let i = 0; i < xData.length; i++) {
          const maxVal = maxData[i];
          if (maxVal == null) continue;
          const x = u.valToPos(xData[i], 'x', true);
          const y = u.valToPos(maxVal, 'y', true);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }

        // Trace min line backward
        for (let i = xData.length - 1; i >= 0; i--) {
          const minVal = minData[i];
          if (minVal == null) continue;
          const x = u.valToPos(xData[i], 'x', true);
          const y = u.valToPos(minVal, 'y', true);
          ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.fill();
        ctx.restore();
      },
    ],
  },
});

/**
 * uPlot plugin that draws red X markers at flagged data points.
 * `flaggedRef` is a React ref holding the merged flagged boolean array.
 * `mainAtRef` maps merged indices back to the raw readings index.
 */
const flaggedPointsPlugin = (
  seriesIdx: number,
  flaggedRef: React.MutableRefObject<(boolean | null)[]>,
  mainAtRef: React.MutableRefObject<(number | null)[]>,
): uPlot.Plugin => ({
  hooks: {
    draw: [
      (u: uPlot) => {
        const data = u.data[seriesIdx];
        const xData = u.data[0];
        const flagged = flaggedRef.current;
        const mainAt = mainAtRef.current;
        if (!data || !xData || !flagged.length) return;

        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        const size = 5;
        ctx.strokeStyle = '#d32f2f';
        ctx.lineWidth = 2;

        for (let i = 0; i < xData.length; i++) {
          const val = data[i];
          if (val == null) continue;
          // Check if this merged index maps to a flagged raw reading
          const rawIdx = mainAt[i];
          if (rawIdx == null || !flagged[rawIdx]) continue;

          const x = u.valToPos(xData[i], 'x', true);
          const y = u.valToPos(val, 'y', true);

          // Draw X marker
          ctx.beginPath();
          ctx.moveTo(x - size, y - size);
          ctx.lineTo(x + size, y + size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + size, y - size);
          ctx.lineTo(x - size, y + size);
          ctx.stroke();
        }

        ctx.restore();
      },
    ],
  },
});

/** Remap a boolean/null array to a merged timeline using an index map. */
function remapFlags(
  source: (boolean | null)[],
  indexMap: (number | null)[],
): (boolean | null)[] {
  return indexMap.map((idx) => (idx != null ? source[idx] : null));
}

/**
 * uPlot plugin that draws diamond markers for a given series index.
 * Used to render grab sample data points distinctly from the continuous line.
 */
const grabSampleDiamondsPlugin = (
  seriesIdx: number,
  show: boolean,
): uPlot.Plugin => ({
  hooks: {
    draw: [
      (u: uPlot) => {
        if (!show) return;
        const data = u.data[seriesIdx];
        const xData = u.data[0];
        if (!data || !xData) return;

        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        const size = 5;
        ctx.fillStyle = '#ff9800';
        ctx.strokeStyle = '#e65100';
        ctx.lineWidth = 1.5;

        for (let i = 0; i < xData.length; i++) {
          const val = data[i];
          if (val == null) continue;
          const x = u.valToPos(xData[i], 'x', true);
          const y = u.valToPos(val, 'y', true);

          ctx.beginPath();
          ctx.moveTo(x, y - size);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x, y + size);
          ctx.lineTo(x - size, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      },
    ],
  },
});

/**
 * Merge two sorted time arrays into a union, returning index maps for
 * remapping value arrays from each source to the merged timeline.
 */
function mergeTimelines(
  mainTimes: number[],
  grabTimes: number[],
): {
  times: number[];
  mainAt: (number | null)[];
  grabAt: (number | null)[];
} {
  if (grabTimes.length === 0) {
    return {
      times: mainTimes,
      mainAt: mainTimes.map((_, i) => i),
      grabAt: mainTimes.map(() => null),
    };
  }

  const map = new Map<number, { m: number | null; g: number | null }>();
  mainTimes.forEach((t, i) => map.set(t, { m: i, g: null }));
  grabTimes.forEach((t, i) => {
    const entry = map.get(t);
    if (entry) entry.g = i;
    else map.set(t, { m: null, g: i });
  });

  const sorted = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  return {
    times: sorted.map(([t]) => t),
    mainAt: sorted.map(([, v]) => v.m),
    grabAt: sorted.map(([, v]) => v.g),
  };
}

/** Remap a source array to a merged timeline using an index map. */
function remapValues(
  source: (number | undefined)[],
  indexMap: (number | null)[],
): (number | undefined)[] {
  return indexMap.map((idx) => (idx != null ? source[idx] : undefined));
}

/** Resolve "auto" aggregation using shared thresholds, or pass through manual choice. */
const resolveAggregation = (
  level: AggregationLevel,
  spanMs: number,
): 'raw' | 'hourly' | 'daily' | 'weekly' | 'monthly' => {
  if (level !== 'auto') return level;
  return resolveAggregationAuto(spanMs);
};

const AGG_LABELS: Record<AggregationLevel, string> = {
  auto: 'Auto',
  raw: 'Raw',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export const ParameterChart: React.FC<ParameterChartProps> = ({
  siteId,
  parameterId,
  parameterName,
  units,
  threshold,
  defaultExpanded = false,
  externalStart,
  externalEnd,
  syncKey,
  prefetchedData,
  prefetchedIsAggregate,
  prefetchedAnnotations,
  prefetchedGrabData,
  onDataMutated,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [internalStart, setStart] = useState<number>(() => Date.now() - 24 * 60 * 60 * 1000);
  const [internalEnd, setEnd] = useState<number>(Date.now);
  const [aggregation, setAggregation] = useState<AggregationLevel>('auto');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [noData, setNoData] = useState(false);
  const authFetch = useAuthFetch();

  // Shared mode: external time range provided by parent
  const isSharedMode = externalStart != null && externalEnd != null;
  const start = isSharedMode ? externalStart : internalStart;
  const end = isSharedMode ? externalEnd : internalEnd;
  const effectiveExpanded = isSharedMode ? true : expanded;

  // Only fetch data range when in standalone mode (shared mode uses parent's slider)
  const dataRange = useSiteDataRange(isSharedMode ? [] : [siteId]);
  const [showBands, setShowBands] = useState(true);
  const [showGrabSamples, setShowGrabSamples] = useState(true);
  const [showFlagged, setShowFlagged] = useState(true);
  const [flagPopoverAnchor, setFlagPopoverAnchor] = useState<HTMLElement | null>(null);
  const [flagPointIdx, setFlagPointIdx] = useState<number | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [flagBusy, setFlagBusy] = useState(false);
  const mergedTimesRef = useRef<number[]>([]);
  const rawTimesISORef = useRef<string[]>([]);
  const mergedFlaggedRef = useRef<(boolean | null)[]>([]);
  const mergedFlagReasonsRef = useRef<(string | null)[]>([]);
  const mainAtRef = useRef<(number | null)[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const annotationsRef = useRef<AnnotationData[]>([]);
  const [annotateRange, setAnnotateRange] = useState<{ start: Date; end: Date } | null>(null);
  const [annotateDialogOpen, setAnnotateDialogOpen] = useState(false);
  const [annotateText, setAnnotateText] = useState('');
  const [annotateCategory, setAnnotateCategory] = useState('other');
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleRangeChange = useCallback((s: number, e: number) => {
    setStart(s);
    setEnd(e);
  }, []);

  const hasPrefetchedData = prefetchedData !== undefined;

  const fetchData = useCallback(async () => {
    if (!effectiveExpanded) return;
    setLoading(true);
    setNoData(false);

    const startISO = new Date(start).toISOString();
    const endISO = new Date(end).toISOString();
    const spanMs = end - start;
    const resolved = resolveAggregation(aggregation, spanMs);
    const isAggregate = hasPrefetchedData
      ? (prefetchedIsAggregate ?? false)
      : resolved !== 'raw';

    try {
      let mainData: ReadingsResponse | AggregatesResponse;
      let fetchedAnnotations: AnnotationData[];
      let grabTimes: number[] = [];
      let grabValues: (number | undefined)[] = [];

      if (hasPrefetchedData) {
        // --- Prefetched path: skip HTTP, use parent-provided data ---
        if (prefetchedData == null) {
          // Parent is still loading or had an error
          setLoading(false);
          return;
        }
        mainData = prefetchedData;
        fetchedAnnotations = (prefetchedAnnotations ?? []).filter(
          (a) => a.parameter_id === parameterId,
        );
        if (showGrabSamples && prefetchedGrabData) {
          const grabParam = prefetchedGrabData.parameters?.find((p) => p.id === parameterId);
          if (prefetchedGrabData.times?.length && grabParam) {
            grabTimes = prefetchedGrabData.times.map((t) => new Date(t).getTime() / 1000);
            grabValues = grabParam.values.map((v) => v ?? undefined) as (number | undefined)[];
          }
        }
      } else {
        // --- HTTP fetch path (standalone mode) ---
        let url: string;
        if (isAggregate) {
          url = `/api/service/sites/${siteId}/aggregates/${resolved}?start=${startISO}&format=json&end=${endISO}`;
        } else {
          url = `/api/service/sites/${siteId}/readings?start=${startISO}&page_size=10000&format=json&measurement_type=continuous&include_flagged=true&end=${endISO}`;
        }
        const annotUrl = `/api/service/sites/${siteId}/annotations?parameter_id=${parameterId}&start=${startISO}&end=${endISO}`;
        const grabUrl = `/api/service/sites/${siteId}/readings?start=${startISO}&page_size=10000&format=json&measurement_type=spot&end=${endISO}`;

        const [res, annRes, grabRes] = await Promise.all([
          authFetch(url),
          authFetch(annotUrl).catch((err) => { console.error('Failed to fetch annotations:', err); return null as Response | null; }),
          showGrabSamples ? authFetch(grabUrl).catch((err) => { console.error('Failed to fetch grab samples:', err); return null as Response | null; }) : Promise.resolve(null),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        mainData = await res.json();
        fetchedAnnotations = annRes?.ok ? await annRes.json() : [];

        if (grabRes?.ok) {
          const grabDataResp: ReadingsResponse = await grabRes.json();
          const grabParam = grabDataResp.parameters?.find((p) => p.id === parameterId);
          if (grabDataResp.times?.length && grabParam) {
            grabTimes = grabDataResp.times.map((t) => new Date(t).getTime() / 1000);
            grabValues = grabParam.values.map((v) => v ?? undefined) as (number | undefined)[];
          }
        }
      }

      setAnnotations(fetchedAnnotations);
      annotationsRef.current = fetchedAnnotations;

      if (isAggregate) {
        const data = mainData as AggregatesResponse;
        const param = data.parameters?.find((p) => p.id === parameterId);
        if (!data.times?.length || !param) {
          uplotRef.current?.destroy();
          uplotRef.current = null;
          setChartData(null);
          setNoData(true);
          return;
        }

        const rawTimes = data.times.map((t) => new Date(t).getTime() / 1000);
        const rawAvg = param.avg.map((v) => v ?? undefined) as (number | undefined)[];
        const rawMin = param.min.map((v) => v ?? undefined) as (number | undefined)[];
        const rawMax = param.max.map((v) => v ?? undefined) as (number | undefined)[];

        setChartData({ times: rawTimes, values: param.avg, minValues: param.min, maxValues: param.max });

        // Merge grab sample times into the timeline
        const hasGrab = showGrabSamples && grabTimes.length > 0;
        const { times, mainAt, grabAt } = hasGrab
          ? mergeTimelines(rawTimes, grabTimes)
          : { times: rawTimes, mainAt: rawTimes.map((_, i) => i), grabAt: rawTimes.map(() => null) };

        const avgValues = remapValues(rawAvg, mainAt);
        const minValues = remapValues(rawMin, mainAt);
        const maxValues = remapValues(rawMax, mainAt);
        const mergedGrab = hasGrab ? remapValues(grabValues, grabAt) : times.map(() => undefined);

        // Build threshold reference lines
        const thresholdSeries: uPlot.Series[] = [];
        const thresholdData: (number | undefined)[][] = [];
        if (threshold) {
          addThresholdLines(threshold, times, thresholdSeries, thresholdData);
        }

        // Series: [x, avg, min, max, grab, ...thresholds]
        const minSeriesIdx = 2;
        const maxSeriesIdx = 3;
        const grabSeriesIdx = 4;

        const allData: uPlot.AlignedData = [
          times,
          avgValues as (number | null | undefined)[],
          minValues as (number | null | undefined)[],
          maxValues as (number | null | undefined)[],
          mergedGrab as (number | null | undefined)[],
          ...thresholdData,
        ];

        const plugins: uPlot.Plugin[] = [minMaxBandPlugin(minSeriesIdx, maxSeriesIdx)];
        if (threshold) {
          plugins.push(thresholdBandsPlugin(threshold, showBands));
        }
        if (hasGrab) {
          plugins.push(grabSampleDiamondsPlugin(grabSeriesIdx, true));
        }
        if (fetchedAnnotations.length > 0) {
          plugins.push(annotationBandsPlugin(fetchedAnnotations));
        }
        plugins.push(annotationInteractionPlugin(tooltipRef, annotationsRef, setAnnotateRange));

        const opts: uPlot.Options = {
          width: chartRef.current?.clientWidth ?? 600,
          height: 200,
          plugins,
          series: [
            {},
            {
              label: `${parameterName} (avg)`,
              stroke: '#2196f3',
              width: 2,
              points: { show: false },
            },
            {
              label: 'Min',
              stroke: 'rgba(33, 150, 243, 0.3)',
              width: 1,
              points: { show: false },
            },
            {
              label: 'Max',
              stroke: 'rgba(33, 150, 243, 0.3)',
              width: 1,
              points: { show: false },
            },
            {
              label: 'Grab Sample',
              stroke: '#ff9800',
              width: 0,
              points: { show: false },
            },
            ...thresholdSeries,
          ],
          axes: [
            {},
            { label: units ?? '', size: 60 },
          ],
          cursor: { ...(syncKey ? { sync: { key: syncKey } } : {}), drag: { x: true, y: false } },
          scales: { x: { time: true } },
        };

        uplotRef.current?.destroy();
        if (chartRef.current) {
          uplotRef.current = new uPlot(opts, allData, chartRef.current);
        }
      } else {
        // Raw readings path
        const data = mainData as ReadingsResponse;
        const param = data.parameters?.find((p) => p.id === parameterId);
        if (!data.times?.length || !param) {
          uplotRef.current?.destroy();
          uplotRef.current = null;
          setChartData(null);
          setNoData(true);
          return;
        }

        const rawTimes = data.times.map((t) => new Date(t).getTime() / 1000);
        const rawValues = param.values.map((v) => v ?? undefined) as (number | undefined)[];
        const rawFlagged: (boolean | null)[] = param.flagged ?? data.times.map(() => null);
        const rawFlagReasons: (string | null)[] = param.flag_reasons ?? data.times.map(() => null);

        // Store ISO times for flag API calls
        rawTimesISORef.current = data.times;

        setChartData({ times: rawTimes, values: param.values });

        // Merge grab sample times into the timeline
        const hasGrab = showGrabSamples && grabTimes.length > 0;
        const { times, mainAt, grabAt } = hasGrab
          ? mergeTimelines(rawTimes, grabTimes)
          : { times: rawTimes, mainAt: rawTimes.map((_, i) => i), grabAt: rawTimes.map(() => null) };

        const values = remapValues(rawValues, mainAt);
        const mergedGrab = hasGrab ? remapValues(grabValues, grabAt) : times.map(() => undefined);

        // Store flag data in refs for the plugin and click handler
        mergedTimesRef.current = times;
        mainAtRef.current = mainAt;
        mergedFlaggedRef.current = rawFlagged;
        mergedFlagReasonsRef.current = rawFlagReasons;

        // Build threshold reference lines
        const thresholdSeries: uPlot.Series[] = [];
        const thresholdData: (number | undefined)[][] = [];
        if (threshold) {
          addThresholdLines(threshold, times, thresholdSeries, thresholdData);
        }

        // Series: [x, continuous, grab, ...thresholds]
        const grabSeriesIdx = 2;

        const allData: uPlot.AlignedData = [
          times,
          values as (number | null | undefined)[],
          mergedGrab as (number | null | undefined)[],
          ...thresholdData,
        ];

        const plugins: uPlot.Plugin[] = [];
        if (threshold) {
          plugins.push(thresholdBandsPlugin(threshold, showBands));
        }
        if (hasGrab) {
          plugins.push(grabSampleDiamondsPlugin(grabSeriesIdx, true));
        }
        if (showFlagged) {
          plugins.push(flaggedPointsPlugin(1, mergedFlaggedRef, mainAtRef));
        }
        if (fetchedAnnotations.length > 0) {
          plugins.push(annotationBandsPlugin(fetchedAnnotations));
        }
        plugins.push(annotationInteractionPlugin(tooltipRef, annotationsRef, setAnnotateRange));

        const opts: uPlot.Options = {
          width: chartRef.current?.clientWidth ?? 600,
          height: 200,
          plugins,
          series: [
            {},
            {
              label: parameterName,
              stroke: '#2196f3',
              width: 2,
              points: { show: false },
            },
            {
              label: 'Grab Sample',
              stroke: '#ff9800',
              width: 0,
              points: { show: false },
            },
            ...thresholdSeries,
          ],
          axes: [
            {},
            { label: units ?? '', size: 60 },
          ],
          cursor: { ...(syncKey ? { sync: { key: syncKey } } : {}), drag: { x: true, y: false } },
          scales: { x: { time: true } },
        };

        uplotRef.current?.destroy();
        if (chartRef.current) {
          uplotRef.current = new uPlot(opts, allData, chartRef.current);
        }
      }
    } catch (err) {
      console.error(`Failed to fetch chart data for ${parameterName}:`, err);
    } finally {
      setLoading(false);
    }
  }, [siteId, parameterId, parameterName, units, threshold, start, end, aggregation, effectiveExpanded, authFetch, showBands, showGrabSamples, showFlagged, hasPrefetchedData, prefetchedData, prefetchedIsAggregate, prefetchedAnnotations, prefetchedGrabData]);

  useEffect(() => {
    fetchData();
    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [fetchData]);

  // Handle resize
  useEffect(() => {
    if (!effectiveExpanded || !chartRef.current) return;

    const observer = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 200,
        });
      }
    });

    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [effectiveExpanded]);

  const handleAnnotateSave = useCallback(async () => {
    if (!annotateRange) return;
    const hdrs: HeadersInit = { 'Content-Type': 'application/json' };
    try {
      const res = await authFetch('/api/service/annotations', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({
          site_id: siteId,
          parameter_id: parameterId,
          start_time: annotateRange.start.toISOString(),
          end_time: annotateRange.end.toISOString(),
          text: annotateText,
          category: annotateCategory,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnnotateDialogOpen(false);
      setAnnotateRange(null);
      setAnnotateText('');
      setAnnotateCategory('other');
      if (onDataMutated) onDataMutated();
      else fetchData();
    } catch (err) {
      console.error('Failed to save annotation:', err);
    }
  }, [annotateRange, annotateText, annotateCategory, authFetch, siteId, parameterId, fetchData, onDataMutated]);

  const flagReadings = useCallback(async (indices: number[]) => {
    setFlagBusy(true);
    const hdrs: HeadersInit = { 'Content-Type': 'application/json' };
    const readings = indices.map((i) => ({
      site_id: siteId,
      parameter_id: parameterId,
      time: rawTimesISORef.current[i],
    }));
    try {
      const res = await authFetch('/api/service/readings/flag', {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ readings, reason: flagReason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFlagPopoverAnchor(null);
      setFlagPointIdx(null);
      setFlagReason('');
      if (onDataMutated) onDataMutated();
      else fetchData();
    } catch (err) {
      console.error('Failed to flag readings:', err);
    } finally {
      setFlagBusy(false);
    }
  }, [authFetch, siteId, parameterId, flagReason, fetchData, onDataMutated]);

  const unflagReadings = useCallback(async (indices: number[]) => {
    setFlagBusy(true);
    const hdrs: HeadersInit = { 'Content-Type': 'application/json' };
    const readings = indices.map((i) => ({
      site_id: siteId,
      parameter_id: parameterId,
      time: rawTimesISORef.current[i],
    }));
    try {
      const res = await authFetch('/api/service/readings/unflag', {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ readings }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFlagPopoverAnchor(null);
      setFlagPointIdx(null);
      if (onDataMutated) onDataMutated();
      else fetchData();
    } catch (err) {
      console.error('Failed to unflag readings:', err);
    } finally {
      setFlagBusy(false);
    }
  }, [authFetch, siteId, parameterId, fetchData, onDataMutated]);

  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const u = uplotRef.current;
    if (!u) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Check if click is inside the plot area
    const { left, top, width, height } = u.bbox;
    const dpr = devicePixelRatio || 1;
    const plotLeft = left / dpr;
    const plotTop = top / dpr;
    const plotRight = plotLeft + width / dpr;
    const plotBottom = plotTop + height / dpr;
    if (cx < plotLeft || cx > plotRight || cy < plotTop || cy > plotBottom) return;

    // Find closest data point
    const xData = u.data[0];
    const yData = u.data[1]; // continuous series
    if (!xData || !yData) return;

    const threshold_px = 10;
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < xData.length; i++) {
      const val = yData[i];
      if (val == null) continue;
      const px = u.valToPos(xData[i], 'x', false);
      const py = u.valToPos(val, 'y', false);
      const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestDist > threshold_px) return;

    // Map merged index back to raw index
    const rawIdx = mainAtRef.current[bestIdx];
    if (rawIdx == null) return;

    setFlagPointIdx(rawIdx);
    setFlagReason(mergedFlagReasonsRef.current[rawIdx] ?? '');
    setFlagPopoverAnchor(e.currentTarget as HTMLElement);
  }, []);

  const chartControls = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {threshold && (
        <Tooltip title={showBands ? 'Hide alarm bands' : 'Show alarm bands'}>
          <Checkbox
            size="small"
            checked={showBands}
            onChange={(e) => { e.stopPropagation(); setShowBands(e.target.checked); }}
            onClick={(e) => e.stopPropagation()}
            sx={{ p: 0.5 }}
            inputProps={{ 'aria-label': 'Toggle alarm bands' }}
          />
        </Tooltip>
      )}
      <Tooltip title={showGrabSamples ? 'Hide grab samples' : 'Show grab samples'}>
        <Checkbox
          size="small"
          checked={showGrabSamples}
          onChange={(e) => { e.stopPropagation(); setShowGrabSamples(e.target.checked); }}
          onClick={(e) => e.stopPropagation()}
          sx={{ p: 0.5, color: '#ff9800', '&.Mui-checked': { color: '#ff9800' } }}
          inputProps={{ 'aria-label': 'Toggle grab samples' }}
        />
      </Tooltip>
      <Tooltip title={showFlagged ? 'Hide flagged points' : 'Show flagged points'}>
        <Checkbox
          size="small"
          checked={showFlagged}
          onChange={(e) => { e.stopPropagation(); setShowFlagged(e.target.checked); }}
          onClick={(e) => e.stopPropagation()}
          icon={<FlagIcon fontSize="small" sx={{ color: 'rgba(211, 47, 47, 0.4)' }} />}
          checkedIcon={<FlagIcon fontSize="small" />}
          sx={{ p: 0.5, color: '#d32f2f', '&.Mui-checked': { color: '#d32f2f' } }}
          inputProps={{ 'aria-label': 'Toggle flagged points' }}
        />
      </Tooltip>
    </Box>
  );

  const chartContent = (
    <>
      {loading && (
        <Typography variant="caption" color="text.secondary">
          Loading chart data...
        </Typography>
      )}
      {!loading && noData && (
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 80,
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'action.hover',
        }}>
          <Typography variant="body2" color="text.secondary">
            No data in selected range
          </Typography>
        </Box>
      )}
      <div style={{ position: 'relative', width: '100%', display: noData ? 'none' : 'block' }} onClick={handleChartClick}>
        <div ref={chartRef} style={{ width: '100%' }} />
        <div
          ref={tooltipRef}
          style={{
            display: 'none',
            position: 'absolute',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 4,
            fontSize: '0.75rem',
            pointerEvents: 'none',
            zIndex: 10,
            maxWidth: 200,
            whiteSpace: 'pre-wrap',
          }}
        />
      </div>
      {annotateRange && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Selected: {annotateRange.start.toLocaleString()} &ndash; {annotateRange.end.toLocaleString()}
          </Typography>
          <Button
            size="small"
            variant="contained"
            onClick={() => setAnnotateDialogOpen(true)}
          >
            Annotate
          </Button>
          <Button
            size="small"
            onClick={() => setAnnotateRange(null)}
          >
            Dismiss
          </Button>
        </Box>
      )}
      <StatisticsPanel
        parameterName={parameterName}
        units={units}
        data={chartData}
      />
    </>
  );

  // Shared mode: compact chart, no collapse, no per-chart slider
  if (isSharedMode) {
    return (
      <>
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1, mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle2">
              {parameterName} {units ? `(${units})` : ''}
            </Typography>
            {chartControls}
          </Box>
          {chartContent}
        </Box>
        <Dialog
          open={annotateDialogOpen}
          onClose={() => setAnnotateDialogOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Add Annotation</DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Text"
              multiline
              minRows={2}
              value={annotateText}
              onChange={(e) => setAnnotateText(e.target.value)}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={annotateCategory}
                onChange={(e) => setAnnotateCategory(e.target.value)}
                label="Category"
              >
                {ANNOTATION_CATEGORIES.map((c) => (
                  <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {annotateRange && (
              <Typography variant="caption" color="text.secondary">
                Range: {annotateRange.start.toLocaleString()} &ndash; {annotateRange.end.toLocaleString()}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAnnotateDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAnnotateSave}
              variant="contained"
              disabled={!annotateText.trim()}
            >
              Save
            </Button>
          </DialogActions>
        </Dialog>
        <Popover
          open={Boolean(flagPopoverAnchor) && flagPointIdx != null}
          anchorEl={flagPopoverAnchor}
          onClose={() => { setFlagPopoverAnchor(null); setFlagPointIdx(null); }}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Box sx={{ p: 2, minWidth: 260 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              <FlagIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5, color: '#d32f2f' }} />
              {flagPointIdx != null && mergedFlaggedRef.current[flagPointIdx]
                ? 'Flagged Reading'
                : 'Flag Reading'}
            </Typography>
            {flagPointIdx != null && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {rawTimesISORef.current[flagPointIdx]
                  ? new Date(rawTimesISORef.current[flagPointIdx]).toLocaleString()
                  : ''}
              </Typography>
            )}
            {flagPointIdx != null && !mergedFlaggedRef.current[flagPointIdx] && (
              <>
                <TextField
                  label="Reason"
                  size="small"
                  fullWidth
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  sx={{ mb: 1 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  disabled={flagBusy || !flagReason.trim()}
                  onClick={() => flagReadings([flagPointIdx])}
                  fullWidth
                >
                  Flag
                </Button>
              </>
            )}
            {flagPointIdx != null && mergedFlaggedRef.current[flagPointIdx] && (
              <>
                {mergedFlagReasonsRef.current[flagPointIdx] && (
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Reason: {mergedFlagReasonsRef.current[flagPointIdx]}
                  </Typography>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  disabled={flagBusy}
                  onClick={() => unflagReadings([flagPointIdx])}
                  fullWidth
                >
                  Unflag
                </Button>
              </>
            )}
          </Box>
        </Popover>
      </>
    );
  }

  // Standalone mode: collapsible card with per-chart time range slider
  return (
    <Card variant="outlined" sx={{ mb: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1,
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Typography variant="subtitle2">
          {parameterName} {units ? `(${units})` : ''}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {expanded && (
            <FormControl size="small" onClick={(e) => e.stopPropagation()}>
              <Select
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as AggregationLevel)}
                sx={{ fontSize: '0.8125rem', height: 31, minWidth: 90 }}
              >
                {(Object.keys(AGG_LABELS) as AggregationLevel[]).map((level) => (
                  <MenuItem key={level} value={level} sx={{ fontSize: '0.8125rem' }}>
                    {AGG_LABELS[level]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {expanded && chartControls}
          <IconButton size="small">
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
      </Box>
      <Collapse in={expanded}>
        <CardContent sx={{ pt: 0 }}>
          <TimeRangeSlider
            compact
            dataMin={dataRange.min}
            dataMax={dataRange.max}
            loading={dataRange.loading}
            start={start}
            end={end}
            onChange={handleRangeChange}
          />
          {chartContent}
        </CardContent>
      </Collapse>
      <Dialog
        open={annotateDialogOpen}
        onClose={() => setAnnotateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Annotation</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Text"
            multiline
            minRows={2}
            value={annotateText}
            onChange={(e) => setAnnotateText(e.target.value)}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select
              value={annotateCategory}
              onChange={(e) => setAnnotateCategory(e.target.value)}
              label="Category"
            >
              {ANNOTATION_CATEGORIES.map((c) => (
                <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {annotateRange && (
            <Typography variant="caption" color="text.secondary">
              Range: {annotateRange.start.toLocaleString()} &ndash; {annotateRange.end.toLocaleString()}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleAnnotateSave}
            variant="contained"
            disabled={!annotateText.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Popover
        open={Boolean(flagPopoverAnchor) && flagPointIdx != null}
        anchorEl={flagPopoverAnchor}
        onClose={() => { setFlagPopoverAnchor(null); setFlagPointIdx(null); }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Box sx={{ p: 2, minWidth: 260 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            <FlagIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5, color: '#d32f2f' }} />
            {flagPointIdx != null && mergedFlaggedRef.current[flagPointIdx]
              ? 'Flagged Reading'
              : 'Flag Reading'}
          </Typography>
          {flagPointIdx != null && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {rawTimesISORef.current[flagPointIdx]
                ? new Date(rawTimesISORef.current[flagPointIdx]).toLocaleString()
                : ''}
            </Typography>
          )}
          {flagPointIdx != null && !mergedFlaggedRef.current[flagPointIdx] && (
            <>
              <TextField
                label="Reason"
                size="small"
                fullWidth
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                sx={{ mb: 1 }}
              />
              <Button
                size="small"
                variant="contained"
                color="error"
                disabled={flagBusy || !flagReason.trim()}
                onClick={() => flagReadings([flagPointIdx])}
                fullWidth
              >
                Flag
              </Button>
            </>
          )}
          {flagPointIdx != null && mergedFlaggedRef.current[flagPointIdx] && (
            <>
              {mergedFlagReasonsRef.current[flagPointIdx] && (
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Reason: {mergedFlagReasonsRef.current[flagPointIdx]}
                </Typography>
              )}
              <Button
                size="small"
                variant="outlined"
                disabled={flagBusy}
                onClick={() => unflagReadings([flagPointIdx])}
                fullWidth
              >
                Unflag
              </Button>
            </>
          )}
        </Box>
      </Popover>
    </Card>
  );
};

/** Helper to build threshold reference line series and data arrays. */
function addThresholdLines(
  threshold: AlarmThreshold,
  times: number[],
  series: uPlot.Series[],
  data: (number | undefined)[][],
) {
  if (threshold.warning_min != null) {
    series.push({
      stroke: 'rgba(255, 152, 0, 0.35)',
      width: 1,
      label: 'Warn min',
      points: { show: false },
    });
    data.push(times.map(() => threshold.warning_min!));
  }
  if (threshold.warning_max != null) {
    series.push({
      stroke: 'rgba(255, 152, 0, 0.35)',
      width: 1,
      label: 'Warn max',
      points: { show: false },
    });
    data.push(times.map(() => threshold.warning_max!));
  }
  if (threshold.alarm_min != null) {
    series.push({
      stroke: 'rgba(244, 67, 54, 0.35)',
      width: 1,
      label: 'Alarm min',
      points: { show: false },
    });
    data.push(times.map(() => threshold.alarm_min!));
  }
  if (threshold.alarm_max != null) {
    series.push({
      stroke: 'rgba(244, 67, 54, 0.35)',
      width: 1,
      label: 'Alarm max',
      points: { show: false },
    });
    data.push(times.map(() => threshold.alarm_max!));
  }
}
