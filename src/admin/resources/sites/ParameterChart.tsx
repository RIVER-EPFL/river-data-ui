import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useKeycloak } from '../../KeycloakContext';
import {
  Box,
  Card,
  CardContent,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Collapse,
  IconButton,
  TextField,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

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
  }>;
}

type TimeRange = '24h' | '7d' | '30d' | 'custom';

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
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(false);
  const keycloak = useKeycloak();
  const [customStart, setCustomStart] = useState<string>(() =>
    toLocalDatetime(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    toLocalDatetime(new Date()),
  );

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
    }
    let url = `/api/service/sites/${siteId}/readings?start=${start.toISOString()}&page_size=10000&format=json`;
    if (end) {
      url += `&end=${end.toISOString()}`;
    }
    const headers: HeadersInit = keycloak?.token ? { 'Authorization': 'Bearer ' + keycloak.token } : {};

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ReadingsResponse = await res.json();

      // Find the parameter in the response
      const param = data.parameters?.find((p) => p.id === parameterId);
      if (!data.times?.length || !param) {
        // No data — destroy existing chart
        uplotRef.current?.destroy();
        uplotRef.current = null;
        return;
      }

      // Convert times to unix timestamps (seconds)
      const times = data.times.map((t) => new Date(t).getTime() / 1000);
      const values = param.values.map((v) => v ?? undefined) as (number | undefined)[];

      // Build threshold bands for uPlot
      const bands: uPlot.Band[] = [];
      const thresholdSeries: uPlot.Series[] = [];
      const thresholdData: (number | undefined)[][] = [];

      if (threshold) {
        // Warning band lines
        if (threshold.warning_min != null) {
          thresholdSeries.push({
            stroke: 'rgba(255, 152, 0, 0.5)',
            dash: [4, 4],
            width: 1,
            label: 'Warn min',
          });
          thresholdData.push(times.map(() => threshold.warning_min!));
        }
        if (threshold.warning_max != null) {
          thresholdSeries.push({
            stroke: 'rgba(255, 152, 0, 0.5)',
            dash: [4, 4],
            width: 1,
            label: 'Warn max',
          });
          thresholdData.push(times.map(() => threshold.warning_max!));
        }
        if (threshold.alarm_min != null) {
          thresholdSeries.push({
            stroke: 'rgba(244, 67, 54, 0.5)',
            dash: [2, 2],
            width: 1,
            label: 'Alarm min',
          });
          thresholdData.push(times.map(() => threshold.alarm_min!));
        }
        if (threshold.alarm_max != null) {
          thresholdSeries.push({
            stroke: 'rgba(244, 67, 54, 0.5)',
            dash: [2, 2],
            width: 1,
            label: 'Alarm max',
          });
          thresholdData.push(times.map(() => threshold.alarm_max!));
        }
      }

      const allData: uPlot.AlignedData = [
        times,
        values as (number | null | undefined)[],
        ...thresholdData,
      ];

      const opts: uPlot.Options = {
        width: chartRef.current?.clientWidth ?? 600,
        height: 200,
        series: [
          {},
          {
            label: parameterName,
            stroke: '#2196f3',
            width: 2,
            points: { show: false },
          },
          ...thresholdSeries,
        ],
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
      };

      // Destroy previous instance
      uplotRef.current?.destroy();

      if (chartRef.current) {
        uplotRef.current = new uPlot(opts, allData, chartRef.current);
      }
    } catch (err) {
      console.error(`Failed to fetch chart data for ${parameterName}:`, err);
    } finally {
      setLoading(false);
    }
  }, [siteId, parameterId, parameterName, units, threshold, timeRange, expanded, customStart, customEnd, keycloak]);

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
          <div ref={chartRef} style={{ width: '100%' }} />
        </CardContent>
      </Collapse>
    </Card>
  );
};
