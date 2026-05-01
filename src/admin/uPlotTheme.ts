import type uPlot from 'uplot';
import { tokens } from './theme';

export const uPlotTheme = {
  axisStrokeColor: tokens.brand.textMuted,
  axisGridColor: '#EAECEF',
  axisLabelFontSize: 11,
  axisLabelFontFamily: tokens.font.body,
  lineWidth: 1.5,
  pointSize: 4,

  alarmBandFill: tokens.severity.alarm.soft,
  warningBandFill: tokens.severity.warning.soft,
  alarmBandStroke: tokens.severity.alarm.border,
  warningBandStroke: tokens.severity.warning.border,

  annotationCategoryColors: {
    maintenance: 'rgba(0,114,178,0.18)',
    quality_issue: 'rgba(213,94,0,0.18)',
    environmental: 'rgba(0,158,115,0.18)',
    other: 'rgba(160,160,160,0.18)',
  },

  grabSampleFill: tokens.markers.grabSample.fill,
  grabSampleStroke: tokens.markers.grabSample.stroke,
  flaggedColor: tokens.markers.flagged.stroke,
  flaggedSize: 5,

  minMaxBandFill: 'rgba(31,78,121,0.12)',

  tooltipBg: 'rgba(20,30,50,0.92)',
  tooltipColor: '#fff',
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
