import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { createDashboard, type DashboardHandle } from './dashboard-engine';
import 'uplot/dist/uPlot.min.css';
import 'nouislider/dist/nouislider.css';

export interface ChartsDashboardRef {
  selectSite: (siteId: string) => void;
}

const DASHBOARD_CSS = `
.river-dashboard {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #1e293b;
  --muted: #64748b;
  --accent: #2563eb;
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--text);
}
.river-dashboard *, .river-dashboard *::before, .river-dashboard *::after {
  box-sizing: border-box;
}
.river-dashboard .container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem;
}
.river-dashboard header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}
.river-dashboard h1 { font-size: 1.25rem; font-weight: 600; }
.river-dashboard .site-groups {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: flex-start;
}
.river-dashboard .project-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: center;
}
.river-dashboard .project-label {
  font-size: 0.6rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
  text-align: center;
}
.river-dashboard .project-sites {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}
.river-dashboard .site-btn {
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  font-size: 0.7rem;
  background: var(--surface);
  cursor: pointer;
  transition: all 0.15s;
}
.river-dashboard .site-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.river-dashboard .site-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
.river-dashboard .slider-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 1.5rem;
  margin-bottom: 1rem;
  user-select: none;
  -webkit-user-select: none;
}
.river-dashboard .slider-section * {
  user-select: none;
  -webkit-user-select: none;
}
.river-dashboard .slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 0.5rem;
}
.river-dashboard .timeline-legend {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: visible;
  margin-top: 2rem;
  margin-bottom: 0.25rem;
  margin-left: 0.5rem;
  margin-right: 0.5rem;
}
.river-dashboard .timeline-region-history,
.river-dashboard .timeline-region-week,
.river-dashboard .timeline-region-today {
  height: 100%;
  position: relative;
}
.river-dashboard .timeline-region-history { background: #94a3b8; }
.river-dashboard .timeline-region-week { background: #3b82f6; }
.river-dashboard .timeline-region-today { background: #10b981; }
.river-dashboard .timeline-region-history::after,
.river-dashboard .timeline-region-week::after {
  content: '';
  position: absolute;
  right: 0;
  top: -2px;
  height: 10px;
  width: 1px;
  background: var(--text);
  opacity: 0.3;
}
.river-dashboard .timeline-labels {
  display: flex;
  margin: 0.25rem 0.5rem 0;
  font-size: 0.6rem;
  color: var(--muted);
}
.river-dashboard .timeline-labels span {
  text-align: center;
  opacity: 0.7;
}
.river-dashboard .noUi-pips-horizontal {
  padding-top: 8px;
  height: 50px;
}
.river-dashboard .noUi-value-horizontal {
  transform: translateX(-50%);
  font-size: 0.6rem;
}
.river-dashboard .noUi-marker-horizontal.noUi-marker-large {
  height: 10px;
}
.river-dashboard #time-slider {
  margin: 0 0.5rem;
}
.river-dashboard .slider-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
}
.river-dashboard .window-info {
  font-size: 0.875rem;
  color: var(--muted);
}
.river-dashboard .resolution-info {
  font-size: 0.75rem;
  color: var(--muted);
  font-style: italic;
}
.river-dashboard .controls-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
}
.river-dashboard .parameter-toggles {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  min-height: 42px;
  align-items: center;
  flex: 1;
}
.river-dashboard .parameter-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
}
.river-dashboard .parameter-toggle input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent);
}
.river-dashboard .alarm-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.15s;
}
.river-dashboard .alarm-toggle:hover {
  border-color: #ef4444;
}
.river-dashboard .alarm-toggle.active {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}
.river-dashboard .alarm-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
}
.river-dashboard .alarm-toggle:not(.active) .alarm-indicator {
  background: var(--muted);
}
.river-dashboard .export-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  gap: 1rem;
}
.river-dashboard .export-toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.river-dashboard .export-toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.river-dashboard .site-hub-link {
  font-size: 0.8rem;
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.15s;
}
.river-dashboard .site-hub-link:hover {
  text-decoration: underline;
  opacity: 0.8;
}
.river-dashboard .export-btn {
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  font-size: 0.8rem;
  background: var(--surface);
  cursor: pointer;
  transition: all 0.15s;
  color: var(--text);
}
.river-dashboard .export-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.river-dashboard .charts-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.river-dashboard .parameter-chart {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  padding-top: 1.5rem;
  padding-bottom: 1rem;
  position: relative;
  overflow: visible;
}
.river-dashboard .parameter-chart .chart-label {
  position: absolute;
  top: 0.5rem;
  left: 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--muted);
  z-index: 10;
  background: var(--surface);
  padding: 0 0.25rem;
}
.river-dashboard .parameter-chart .chart-label-link {
  text-decoration: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.river-dashboard .parameter-chart .chart-label-link:hover {
  text-decoration: underline;
  opacity: 0.8;
}
.river-dashboard .parameter-chart .chart-expand {
  position: absolute;
  bottom: 0.5rem;
  right: 0.5rem;
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: var(--surface);
  cursor: pointer;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  z-index: 10;
  opacity: 0.6;
  transition: opacity 0.15s;
}
.river-dashboard .parameter-chart .chart-expand:hover {
  opacity: 1;
  border-color: var(--accent);
  color: var(--accent);
}
.river-dashboard .parameter-chart .u-wrap {
  cursor: crosshair;
}
.river-dashboard .parameter-chart .u-over {
  overflow: visible !important;
}
.river-dashboard .chart-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 180px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}
.river-dashboard .chart-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.7rem;
  color: var(--muted);
  margin-top: 0.5rem;
  gap: 1rem;
}
.river-dashboard .footer-left, .river-dashboard .footer-right {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s;
}
.river-dashboard .footer-left:hover, .river-dashboard .footer-right:hover { opacity: 0.8; }
.river-dashboard .chart-footer a {
  color: inherit;
  text-decoration: none;
}
.river-dashboard .chart-footer a:hover { text-decoration: underline; }
.river-dashboard .chart-hint {
  text-align: center;
  opacity: 0.4;
}
.river-dashboard .footer-separator { margin: 0 0.1rem; }
.river-dashboard .hover-tooltip {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  pointer-events: none;
  z-index: 100;
  font-size: 0.8rem;
  min-width: 180px;
  display: none;
}
.river-dashboard .hover-tooltip.visible {
  display: block;
}
.river-dashboard .hover-tooltip .tooltip-time {
  font-weight: 600;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.river-dashboard .hover-tooltip .tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.2rem 0;
}
.river-dashboard .hover-tooltip .tooltip-label {
  color: var(--muted);
}
.river-dashboard .hover-tooltip .tooltip-value {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.river-dashboard .alarm-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 0.2rem;
  vertical-align: middle;
  margin-left: 0.3rem;
  letter-spacing: 0.02em;
}
.river-dashboard .alarm-badge.warning { background: rgba(245, 158, 11, 0.3); color: #b45309; }
.river-dashboard .alarm-badge.critical { background: rgba(239, 68, 68, 0.3); color: #b91c1c; }
.river-dashboard .noUi-target {
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: none;
}
.river-dashboard .noUi-connect {
  background: var(--accent);
}
.river-dashboard .noUi-handle {
  border: 2px solid var(--accent);
  background: var(--surface);
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.river-dashboard .noUi-handle:before, .river-dashboard .noUi-handle:after {
  background: var(--accent);
}
.river-dashboard .noUi-tooltip {
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  background: var(--text);
  color: white;
  border: none;
}
.river-dashboard .noUi-pips {
  color: var(--muted);
  font-size: 0.65rem;
}
.river-dashboard .noUi-marker-large {
  background: var(--border);
}
.river-dashboard .noUi-value {
  color: var(--muted);
}
.river-dashboard .loading-spinner {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: rd-spin 0.6s linear infinite;
  margin-left: 0.5rem;
  vertical-align: middle;
}
@keyframes rd-spin { to { transform: rotate(360deg); } }
`;

const ChartsDashboard = forwardRef<ChartsDashboardRef>(function ChartsDashboard(_props, ref) {
  const authFetch = useAuthFetch();
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<DashboardHandle | null>(null);

  useImperativeHandle(ref, () => ({
    selectSite: (siteId: string) => handleRef.current?.selectSite(siteId),
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const api = (url: string, noCache = false) => {
      const finalUrl = noCache ? `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}` : url;
      return authFetchRef.current(finalUrl).then((r) => r.json());
    };

    const wrappedFetch = (url: string) => authFetchRef.current(url);

    handleRef.current = createDashboard(containerRef.current, api, wrappedFetch);

    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return (
    <>
      <style>{DASHBOARD_CSS}</style>
      <div ref={containerRef} className="river-dashboard" />
    </>
  );
});

export default ChartsDashboard;
