import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useKeycloak } from '../../KeycloakContext';
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
  ToggleButton,
  ToggleButtonGroup,
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
}

interface ReadingsResponse {
  times: string[];
  parameters: Array<{
    id: string;
    name: string;
    type: string;
    units: string | null;
    values: Array<number | null>;
    flagged?: Array<boolean | null>;
    flag_reasons?: Array<string | null>;
  }>;
}

interface AggregatesResponse {
  times: string[];
  parameters: Array<{
    id: string;
    name: string;
    type: string;
    units: string | null;
    avg: Array<number | null>;
    min: Array<number | null>;
    max: Array<number | null>;
    count: number[];
  }>;
}

type TimeRange = '24h' | '7d' | '30d' | 'custom';
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

const TIME_RANGE_MS: Record<Exclude<TimeRange, 'custom'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Format a Date as a `datetime-local` input value (YYYY-MM-DDTHH:mm). */
const toLocalDatetime = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Resolve "auto" aggregation to a concrete level based on time span in ms. */
const resolveAggregation = (
  level: AggregationLevel,
  spanMs: number,
): 'raw' | 'hourly' | 'daily' | 'weekly' | 'monthly' => {
  if (level !== 'auto') return level;
  const days = spanMs / (24 * 60 * 60 * 1000);
  if (days > 30) return 'daily';
  if (days > 7) return 'hourly';
  return 'raw';
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
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [aggregation, setAggregation] = useState<AggregationLevel>('auto');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const keycloak = useKeycloak();
  const [customStart, setCustomStart] = useState<string>(() =>
    toLocalDatetime(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    toLocalDatetime(new Date()),
  );
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

  const fetchData = useCallback(async () => {
    if (!expanded) return;
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

    const spanMs = (end ?? new Date()).getTime() - start.getTime();
    const resolved = resolveAggregation(aggregation, spanMs);
    const isAggregate = resolved !== 'raw';

    let url: string;
    if (isAggregate) {
      url = `/api/service/sites/${siteId}/aggregates/${resolved}?start=${start.toISOString()}&format=json`;
    } else {
      url = `/api/service/sites/${siteId}/readings?start=${start.toISOString()}&page_size=10000&format=json&measurement_type=continuous&include_flagged=true`;
    }
    if (end) {
      url += `&end=${end.toISOString()}`;
    }
    const headers: HeadersInit = keycloak?.token ? { 'Authorization': 'Bearer ' + keycloak.token } : {};
    const annotUrl = `/api/service/sites/${siteId}/annotations?parameter_id=${parameterId}&start=${start.toISOString()}` + (end ? `&end=${end.toISOString()}` : '');

    // Grab sample URL — always fetched as raw readings with measurement_type=spot
    let grabUrl = `/api/service/sites/${siteId}/readings?start=${start.toISOString()}&page_size=10000&format=json&measurement_type=spot`;
    if (end) grabUrl += `&end=${end.toISOString()}`;

    try {
      const [res, annRes, grabRes] = await Promise.all([
        fetch(url, { headers }),
        fetch(annotUrl, { headers }).catch(() => null as Response | null),
        showGrabSamples ? fetch(grabUrl, { headers }).catch(() => null as Response | null) : Promise.resolve(null),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fetchedAnnotations: AnnotationData[] = annRes?.ok ? await annRes.json() : [];

      // Parse grab sample data
      let grabTimes: number[] = [];
      let grabValues: (number | undefined)[] = [];
      if (grabRes?.ok) {
        const grabData: ReadingsResponse = await grabRes.json();
        const grabParam = grabData.parameters?.find((p) => p.id === parameterId);
        if (grabData.times?.length && grabParam) {
          grabTimes = grabData.times.map((t) => new Date(t).getTime() / 1000);
          grabValues = grabParam.values.map((v) => v ?? undefined) as (number | undefined)[];
        }
      }
      setAnnotations(fetchedAnnotations);
      annotationsRef.current = fetchedAnnotations;

      if (isAggregate) {
        const data: AggregatesResponse = await res.json();
        const param = data.parameters?.find((p) => p.id === parameterId);
        if (!data.times?.length || !param) {
          uplotRef.current?.destroy();
          uplotRef.current = null;
          setChartData(null);
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
          cursor: { drag: { x: true, y: false } },
          scales: { x: { time: true } },
        };

        uplotRef.current?.destroy();
        if (chartRef.current) {
          uplotRef.current = new uPlot(opts, allData, chartRef.current);
        }
      } else {
        // Raw readings path (original logic)
        const data: ReadingsResponse = await res.json();
        const param = data.parameters?.find((p) => p.id === parameterId);
        if (!data.times?.length || !param) {
          uplotRef.current?.destroy();
          uplotRef.current = null;
          setChartData(null);
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
          cursor: { drag: { x: true, y: false } },
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
  }, [siteId, parameterId, parameterName, units, threshold, timeRange, aggregation, expanded, customStart, customEnd, keycloak, showBands, showGrabSamples, showFlagged]);

  useEffect(() => {
    fetchData();
    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [fetchData]);

  // Handle resize
  useEffect(() => {
    if (!expanded || !chartRef.current) return;

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
  }, [expanded]);

  const handleAnnotateSave = useCallback(async () => {
    if (!annotateRange) return;
    const hdrs: HeadersInit = keycloak?.token
      ? { 'Authorization': 'Bearer ' + keycloak.token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
    try {
      const res = await fetch('/api/service/annotations', {
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
      fetchData();
    } catch (err) {
      console.error('Failed to save annotation:', err);
    }
  }, [annotateRange, annotateText, annotateCategory, keycloak, siteId, parameterId, fetchData]);

  const flagReadings = useCallback(async (indices: number[]) => {
    setFlagBusy(true);
    const hdrs: HeadersInit = keycloak?.token
      ? { 'Authorization': 'Bearer ' + keycloak.token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
    const readings = indices.map((i) => ({
      site_id: siteId,
      parameter_id: parameterId,
      time: rawTimesISORef.current[i],
    }));
    try {
      const res = await fetch('/api/service/readings/flag', {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ readings, reason: flagReason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFlagPopoverAnchor(null);
      setFlagPointIdx(null);
      setFlagReason('');
      fetchData();
    } catch (err) {
      console.error('Failed to flag readings:', err);
    } finally {
      setFlagBusy(false);
    }
  }, [keycloak, siteId, parameterId, flagReason, fetchData]);

  const unflagReadings = useCallback(async (indices: number[]) => {
    setFlagBusy(true);
    const hdrs: HeadersInit = keycloak?.token
      ? { 'Authorization': 'Bearer ' + keycloak.token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
    const readings = indices.map((i) => ({
      site_id: siteId,
      parameter_id: parameterId,
      time: rawTimesISORef.current[i],
    }));
    try {
      const res = await fetch('/api/service/readings/unflag', {
        method: 'PATCH',
        headers: hdrs,
        body: JSON.stringify({ readings }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFlagPopoverAnchor(null);
      setFlagPointIdx(null);
      fetchData();
    } catch (err) {
      console.error('Failed to unflag readings:', err);
    } finally {
      setFlagBusy(false);
    }
  }, [keycloak, siteId, parameterId, fetchData]);

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
            <ToggleButtonGroup
              value={timeRange}
              exclusive
              onChange={(_, v) => { if (v) setTimeRange(v); }}
              size="small"
              onClick={(e) => e.stopPropagation()}
            >
              <ToggleButton value="24h">24h</ToggleButton>
              <ToggleButton value="7d">7d</ToggleButton>
              <ToggleButton value="30d">30d</ToggleButton>
              <ToggleButton value="custom">Custom</ToggleButton>
            </ToggleButtonGroup>
          )}
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
          {expanded && threshold && (
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
          {expanded && (
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
          )}
          {expanded && (
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
          )}
          {expanded && timeRange === 'custom' && (
            <Box
              sx={{ display: 'flex', gap: 1, alignItems: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
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
          <IconButton size="small">
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
      </Box>
      <Collapse in={expanded}>
        <CardContent sx={{ pt: 0 }}>
          {loading && (
            <Typography variant="caption" color="text.secondary">
              Loading chart data...
            </Typography>
          )}
          <div style={{ position: 'relative', width: '100%' }} onClick={handleChartClick}>
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
