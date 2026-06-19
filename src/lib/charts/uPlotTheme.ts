import uPlot from 'uplot';
import { tokens } from './tokens';
import { timezoneStore } from '$lib/stores/timezone.svelte';

/**
 * uPlot options fragment controlling the time-axis zone. In UTC mode it labels ticks in UTC; in
 * local mode it returns nothing so uPlot's default (browser-local) tzDate applies. Spread into a
 * `uPlot.Options` built inside a reactive context (render `$effect` / `$derived`) so toggling the
 * global timezone preference re-renders the chart.
 */
export function tzDateOption(): Partial<Pick<uPlot.Options, 'tzDate'>> {
  return timezoneStore.zone === 'UTC'
    ? { tzDate: (ts: number) => uPlot.tzDate(new Date(ts * 1000), 'UTC') }
    : {};
}

export const uPlotTheme = {
  axisStrokeColor: tokens.brand.textMuted,
  axisGridColor: tokens.chart.grid,
  axisLabelFontSize: 11,
  axisLabelFontFamily: tokens.font.body,
  lineWidth: 1.5,
  pointSize: 4,

  alarmBandFill: tokens.severity.alarm.soft,
  warningBandFill: tokens.severity.warning.soft,
  alarmBandStroke: tokens.severity.alarm.border,
  warningBandStroke: tokens.severity.warning.border,

  annotationCategoryColors: tokens.annotationCategories,

  grabSampleFill: tokens.markers.grabSample.fill,
  grabSampleStroke: tokens.markers.grabSample.stroke,
  flaggedColor: tokens.markers.flagged.stroke,
  flaggedSize: 5,

  minMaxBandFill: tokens.chart.minMaxBand,

  tooltipBg: tokens.chart.tooltipBg,
  tooltipColor: tokens.chart.tooltipText,
  tooltipFontSize: '12px',
  tooltipPadding: '4px 8px',
  tooltipRadius: 4,

  legendShow: false,
};

export function makeSeries(
  paletteIndex: number,
  label: string,
  units?: string | null,
): uPlot.Series {
  return {
    label,
    stroke: tokens.dataViz[paletteIndex % tokens.dataViz.length],
    width: uPlotTheme.lineWidth,
    value: (_u, v) => (v == null ? '--' : v.toFixed(2) + (units ? ' ' + units : '')),
  };
}

export const GAP_THRESHOLDS: Record<string, number> = {
  raw: 1800,
  hourly: 10800,
  daily: 259200,
  weekly: 1814400,
};

export function makeGaps(thresholdSeconds: number): uPlot.Series.GapsRefiner {
  return (self, _seriesIdx, idx0, idx1, nullGaps) => {
    const times = self.data[0] as number[];
    const gaps: uPlot.Series.Gaps = [...nullGaps];
    for (let i = idx0 + 1; i <= idx1; i++) {
      if (times[i] - times[i - 1] > thresholdSeconds) {
        const fromPx = self.valToPos(times[i - 1], 'x', true);
        const toPx = self.valToPos(times[i], 'x', true);
        gaps.push([fromPx, toPx]);
      }
    }
    return gaps;
  };
}

export function makeAxis(opts: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: uPlotTheme.axisStrokeColor,
    grid: { stroke: uPlotTheme.axisGridColor },
    ticks: { stroke: uPlotTheme.axisStrokeColor },
    font: `${uPlotTheme.axisLabelFontSize}px ${uPlotTheme.axisLabelFontFamily}`,
    size: 50,
    ...opts,
  };
}
