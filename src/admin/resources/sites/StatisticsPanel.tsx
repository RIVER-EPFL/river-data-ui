import React, { useMemo, useState } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

export interface ChartData {
  times: number[];
  values: (number | null | undefined)[];
  /** For aggregate data — if present, stats are computed from these */
  minValues?: (number | null | undefined)[];
  maxValues?: (number | null | undefined)[];
}

interface StatisticsPanelProps {
  parameterName: string;
  units: string | null;
  data: ChartData | null;
  /** Expected sample interval in seconds (for % missing calc) */
  sampleIntervalSec?: number;
}

interface Stats {
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  count: number;
  pctMissing: number;
}

const computeStats = (
  data: ChartData,
  sampleIntervalSec: number,
): Stats | null => {
  const nonNull: number[] = [];
  for (const v of data.values) {
    if (v != null) nonNull.push(v);
  }
  if (nonNull.length === 0) return null;

  const sum = nonNull.reduce((a, b) => a + b, 0);
  const mean = sum / nonNull.length;
  const min = Math.min(...nonNull);
  const max = Math.max(...nonNull);

  const variance =
    nonNull.reduce((acc, v) => acc + (v - mean) ** 2, 0) / nonNull.length;
  const stdDev = Math.sqrt(variance);

  // % missing: based on expected readings in the time span
  let pctMissing = 0;
  if (data.times.length >= 2 && sampleIntervalSec > 0) {
    const spanSec = data.times[data.times.length - 1] - data.times[0];
    const expectedCount = Math.max(1, Math.round(spanSec / sampleIntervalSec) + 1);
    const actualCount = nonNull.length;
    pctMissing = Math.max(0, ((expectedCount - actualCount) / expectedCount) * 100);
  }

  return { mean, min, max, stdDev, count: nonNull.length, pctMissing };
};

const fmt = (n: number, decimals = 4): string => {
  if (Math.abs(n) < 0.0001 && n !== 0) return n.toExponential(2);
  return n.toFixed(decimals).replace(/\.?0+$/, '') || '0';
};

export const StatisticsPanel: React.FC<StatisticsPanelProps> = ({
  parameterName,
  units,
  data,
  sampleIntervalSec = 600,
}) => {
  const [open, setOpen] = useState(false);

  const stats = useMemo(
    () => (data ? computeStats(data, sampleIntervalSec) : null),
    [data, sampleIntervalSec],
  );

  const copyToClipboard = () => {
    if (!stats) return;
    const header = 'Parameter\tUnits\tMean\tMin\tMax\tStd Dev\tN\t% Missing';
    const row = [
      parameterName,
      units ?? '',
      fmt(stats.mean),
      fmt(stats.min),
      fmt(stats.max),
      fmt(stats.stdDev),
      stats.count,
      fmt(stats.pctMissing, 1),
    ].join('\t');
    navigator.clipboard.writeText(`${header}\n${row}`);
  };

  if (!data || !stats) return null;

  return (
    <Box sx={{ mt: 0.5 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          gap: 0.5,
        }}
        onClick={() => setOpen(!open)}
      >
        <IconButton size="small" sx={{ p: 0.25 }}>
          {open ? (
            <ExpandLessIcon fontSize="small" />
          ) : (
            <ExpandMoreIcon fontSize="small" />
          )}
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          Statistics
        </Typography>
      </Box>
      <Collapse in={open}>
        <TableContainer>
          <Table size="small" sx={{ '& td, & th': { py: 0.25, px: 1, fontSize: '0.75rem' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Mean</TableCell>
                <TableCell>Min</TableCell>
                <TableCell>Max</TableCell>
                <TableCell>Std Dev</TableCell>
                <TableCell>N</TableCell>
                <TableCell>% Missing</TableCell>
                <TableCell padding="none" sx={{ width: 32 }}>
                  <Tooltip title="Copy as TSV">
                    <IconButton size="small" onClick={copyToClipboard} sx={{ p: 0.25 }}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>{fmt(stats.mean)}</TableCell>
                <TableCell>{fmt(stats.min)}</TableCell>
                <TableCell>{fmt(stats.max)}</TableCell>
                <TableCell>{fmt(stats.stdDev)}</TableCell>
                <TableCell>{stats.count}</TableCell>
                <TableCell>{fmt(stats.pctMissing, 1)}%</TableCell>
                <TableCell padding="none" />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>
    </Box>
  );
};
