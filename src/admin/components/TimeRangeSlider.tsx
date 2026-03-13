import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Typography, Skeleton } from '@mui/material';
import noUiSlider, { type API as SliderAPI } from 'nouislider';
import 'nouislider/dist/nouislider.css';
import {
  TIME_RANGE_PRESETS,
  formatDuration,
  formatDateTimeFull,
  formatDateShort,
  resolveAggregation,
} from '../utils/timeRange';

interface TimeRangeSliderProps {
  /** Earliest available data timestamp (ms since epoch) */
  dataMin: number;
  /** Latest available data timestamp (ms since epoch) */
  dataMax: number;
  /** Whether the data range is still loading */
  loading?: boolean;
  /** Current start timestamp (ms since epoch) */
  start: number;
  /** Current end timestamp (ms since epoch) */
  end: number;
  /** Called when the user changes the range via slider or quick button */
  onChange: (start: number, end: number) => void;
  /** Which quick-select buttons to show. Default: ['24h', '7d', '30d'] */
  presets?: string[];
  /** noUiSlider step in ms. Default: 600000 (10 minutes) */
  step?: number;
  /** Compact mode (less vertical space, for ParameterChart headers). Default: false */
  compact?: boolean;
}

const SLIDER_CSS = `
.trs-slider .noUi-target {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  box-shadow: none;
  height: 8px;
}
.trs-slider .noUi-connect {
  background: #2563eb;
}
.trs-slider .noUi-handle {
  border: 2px solid #2563eb;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  width: 18px !important;
  height: 18px !important;
  right: -9px !important;
  top: -6px !important;
  border-radius: 50%;
  cursor: grab;
}
.trs-slider .noUi-handle:before,
.trs-slider .noUi-handle:after {
  display: none;
}
.trs-slider .noUi-tooltip {
  font-size: 0.65rem;
  padding: 2px 6px;
  background: #1e293b;
  color: #fff;
  border: none;
  border-radius: 4px;
  white-space: nowrap;
}
.trs-slider .noUi-pips-horizontal {
  padding-top: 6px;
  height: 40px;
}
.trs-slider .noUi-value-horizontal {
  transform: translateX(-50%);
  font-size: 0.6rem;
  color: #64748b;
}
.trs-slider .noUi-marker-horizontal.noUi-marker-large {
  height: 8px;
  background: #e2e8f0;
}
.trs-slider-compact .noUi-target {
  height: 6px;
}
.trs-slider-compact .noUi-handle {
  width: 14px !important;
  height: 14px !important;
  right: -7px !important;
  top: -5px !important;
}
`;

export const TimeRangeSlider: React.FC<TimeRangeSliderProps> = ({
  dataMin,
  dataMax,
  loading = false,
  start,
  end,
  onChange,
  presets = ['24h', '7d', '30d'],
  step = 600000,
  compact = false,
}) => {
  const sliderElRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<SliderAPI | null>(null);
  const styleInjected = useRef(false);
  // Local span for smooth info-text updates during drag (avoids waiting for React re-render)
  const [liveSpanMs, setLiveSpanMs] = useState<number | null>(null);

  // Inject CSS once
  useEffect(() => {
    if (styleInjected.current) return;
    styleInjected.current = true;
    const style = document.createElement('style');
    style.textContent = SLIDER_CSS;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Determine which preset is active (if any)
  const activePreset = (() => {
    if (!dataMax) return null;
    for (const key of presets) {
      const ms = TIME_RANGE_PRESETS[key];
      if (!ms) continue;
      const expectedStart = Math.max(dataMin, dataMax - ms);
      // Allow 1-step tolerance for snapping
      if (Math.abs(start - expectedStart) <= step && Math.abs(end - dataMax) <= step) {
        return key;
      }
    }
    return null;
  })();

  const handlePreset = useCallback(
    (_: React.MouseEvent, value: string | null) => {
      if (!value || !dataMax) return;
      const ms = TIME_RANGE_PRESETS[value];
      if (!ms) return;
      const newStart = Math.max(dataMin, dataMax - ms);
      onChange(newStart, dataMax);
    },
    [dataMin, dataMax, onChange],
  );

  // Create / recreate slider when data range changes
  useEffect(() => {
    const el = sliderElRef.current;
    if (!el || !dataMin || !dataMax || dataMin >= dataMax) return;

    // Destroy existing
    if (sliderRef.current) {
      sliderRef.current.destroy();
      sliderRef.current = null;
    }

    const rangeDays = (dataMax - dataMin) / 86400000;
    const oneDayMs = 86400000;
    const oneWeekMs = 7 * oneDayMs;
    const todayStart = dataMax - oneDayMs;
    const weekStart = dataMax - oneWeekMs;

    // Build non-linear range for longer datasets
    let sliderRange: { min: number; max: number; [key: string]: number };
    let pipsConfig: any;

    if (!compact) {
      if (rangeDays > 8) {
        sliderRange = { min: dataMin, '50%': weekStart, '80%': todayStart, max: dataMax };
        pipsConfig = {
          mode: 'positions' as const,
          values: [0, 25, 50, 65, 80, 90, 100],
          density: 100,
          format: {
            to: (v: number) => {
              const hoursFromEnd = (dataMax - v) / 3600000;
              if (hoursFromEnd <= 24) {
                const h = new Date(v).getHours();
                if (h === 0) return formatDateShort(v);
                if (h === 6 || h === 12 || h === 18) return h + ':00';
                return '';
              }
              return formatDateShort(v);
            },
          },
        };
      } else if (rangeDays > 2) {
        sliderRange = { min: dataMin, '70%': todayStart, max: dataMax };
        pipsConfig = {
          mode: 'positions' as const,
          values: [0, 20, 40, 60, 85, 100],
          format: {
            to: (v: number) => {
              const hoursFromEnd = (dataMax - v) / 3600000;
              if (hoursFromEnd <= 24) {
                const h = new Date(v).getHours();
                if (h === 0) return formatDateShort(v);
                if (h === 12) return '12:00';
                return '';
              }
              return formatDateShort(v);
            },
          },
        };
      } else {
        sliderRange = { min: dataMin, max: dataMax };
        pipsConfig = {
          mode: 'count' as const,
          values: 6,
          format: {
            to: (v: number) => {
              if (rangeDays < 1) {
                return new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
              }
              return formatDateShort(v);
            },
          },
        };
      }
    } else {
      sliderRange = { min: dataMin, max: dataMax };
      pipsConfig = false;
    }

    const clampedStart = Math.max(dataMin, Math.min(start, dataMax));
    const clampedEnd = Math.max(dataMin, Math.min(end, dataMax));

    const slider = noUiSlider.create(el, {
      start: [clampedStart, clampedEnd],
      connect: true,
      range: sliderRange,
      step,
      tooltips: [
        { to: (v: number) => formatDateTimeFull(v) },
        { to: (v: number) => formatDateTimeFull(v) },
      ],
      pips: pipsConfig || undefined,
    });

    // 'slide' fires only on user interaction (NOT on programmatic set()),
    // so there's no feedback loop with the sync effect below.
    // Update local span immediately for smooth info-text, and propagate to parent.
    slider.on('slide', (values: (string | number)[]) => {
      const s = Number(values[0]);
      const e = Number(values[1]);
      setLiveSpanMs(e - s);
      onChange(s, e);
    });

    // Clear live span override when the user releases the handle
    slider.on('change', () => {
      setLiveSpanMs(null);
    });

    // Prevent text selection during drag
    el.addEventListener('dragstart', (ev) => ev.preventDefault());
    el.addEventListener('selectstart', (ev) => ev.preventDefault());

    sliderRef.current = slider;

    return () => {
      slider.destroy();
      sliderRef.current = null;
    };
  }, [dataMin, dataMax, compact, step]);

  // Sync slider handles when start/end props change (from quick buttons or parent).
  // Since we use 'slide' (not 'update'), programmatic set() won't re-trigger onChange.
  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;

    const clampedStart = Math.max(dataMin, Math.min(start, dataMax));
    const clampedEnd = Math.max(dataMin, Math.min(end, dataMax));

    // Skip if slider is already at the target position (avoids unnecessary DOM work during drag)
    const current = slider.get() as string[];
    if (Math.abs(Number(current[0]) - clampedStart) < 1 && Math.abs(Number(current[1]) - clampedEnd) < 1) return;

    slider.set([clampedStart, clampedEnd]);
  }, [start, end, dataMin, dataMax]);

  const spanMs = liveSpanMs ?? (end - start);
  const resolution = resolveAggregation(spanMs);
  const rangeDays = dataMax && dataMin ? (dataMax - dataMin) / 86400000 : 0;

  // Timeline legend zone widths
  const zones = (() => {
    if (compact || rangeDays <= 2) return null;
    if (rangeDays > 8) {
      return [
        { width: '50%', color: '#94a3b8', label: 'History' },
        { width: '30%', color: '#3b82f6', label: 'Last week' },
        { width: '20%', color: '#10b981', label: 'Last day' },
      ];
    }
    return [
      { width: '70%', color: '#3b82f6', label: 'This week' },
      { width: '30%', color: '#10b981', label: 'Last day' },
    ];
  })();

  if (loading) {
    return (
      <Box sx={{ width: '100%', py: compact ? 0.5 : 1 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
          {presets.map((p) => (
            <Skeleton key={p} variant="rounded" width={40} height={28} />
          ))}
        </Box>
        <Skeleton variant="rounded" height={compact ? 20 : 50} />
      </Box>
    );
  }

  if (!dataMin || !dataMax || dataMin >= dataMax) {
    return null;
  }

  return (
    <Box
      className={`trs-slider ${compact ? 'trs-slider-compact' : ''}`}
      sx={{ width: '100%', py: compact ? 0.5 : 1 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Quick-select buttons */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: compact ? 0.5 : 1 }}>
        <ToggleButtonGroup
          value={activePreset}
          exclusive
          onChange={handlePreset}
          size="small"
        >
          {presets.map((p) => (
            <ToggleButton key={p} value={p} sx={{ fontSize: '0.75rem', py: 0.25, px: 1 }}>
              {p}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {formatDuration(spanMs)}
          {!compact && (
            <Typography component="span" variant="caption" sx={{ ml: 1, fontStyle: 'italic', color: 'text.disabled' }}>
              ({resolution === 'raw' ? 'raw' : `${resolution} avg`})
            </Typography>
          )}
        </Typography>
      </Box>

      {/* Slider */}
      <Box sx={{ px: compact ? 0 : 0.5 }}>
        <div ref={sliderElRef} />
      </Box>

      {/* Timeline legend zones (non-compact only) */}
      {zones && (
        <>
          <Box
            sx={{
              display: 'flex',
              height: 6,
              borderRadius: '3px',
              overflow: 'hidden',
              mt: 2,
              mx: 0.5,
            }}
          >
            {zones.map((zone, i) => (
              <Box
                key={i}
                sx={{
                  width: zone.width,
                  height: '100%',
                  backgroundColor: zone.color,
                  position: 'relative',
                  '&:not(:last-child)::after': {
                    content: '""',
                    position: 'absolute',
                    right: 0,
                    top: -2,
                    height: 10,
                    width: 1,
                    backgroundColor: '#1e293b',
                    opacity: 0.3,
                  },
                }}
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', mx: 0.5, mt: 0.25 }}>
            {zones.map((zone, i) => (
              <Typography
                key={i}
                variant="caption"
                sx={{
                  width: zone.width,
                  textAlign: 'center',
                  fontSize: '0.6rem',
                  color: zone.color,
                  opacity: 0.7,
                }}
              >
                {zone.label}
              </Typography>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
};
