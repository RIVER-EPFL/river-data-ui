import uPlot from 'uplot';
import noUiSlider, { PipsMode, type Options as NoUiSliderOptions } from 'nouislider';
import { tokens } from './tokens';
import { uPlotTheme, makeGaps, GAP_THRESHOLDS } from './uPlotTheme';

/** Minimal project shape returned by /api/projects */
interface DashboardProject {
  id: string;
  name: string;
}

/** Minimal site shape returned by /api/sites */
interface DashboardSite {
  id: string;
  name: string;
  project_id: string;
}

/** Site detail returned by /api/sites/{id}/detail */
interface SiteDetail {
  id: string;
  name: string;
  data_start: string | null;
  data_end: string | null;
  parameters: SiteDetailParameter[];
}

/** Parameter entry within a site detail response */
interface SiteDetailParameter {
  sensor_type?: string;
  name: string;
}

/** A single parameter in the readings/aggregates response */
interface ReadingsParameter {
  id: string;
  name: string;
  display_name?: string;
  type: string;
  units?: string;
  values?: (number | null)[];
  avg?: (number | null)[];
  severities?: (number | null)[];
  max_severity?: (number | null)[];
}

/** Shape of readings/aggregates API response */
interface ReadingsData {
  times: string[];
  parameters: ReadingsParameter[];
}

/** An alarm band extracted from readings severity data */
interface AlarmBand {
  when_on: string;
  when_off: string | null;
  severity: number;
  parameter_id: string;
  parameter_name: string;
  parameter_type: string;
}

/** Per-type chart data stored in state.chartData */
interface ChartDataEntry {
  params: ReadingsParameter[];
  timestamps: number[];
}

/** Grab sample metadata from the samples CrudCrate resource */
interface SampleRecord {
  id: string;
  parameter_id: string;
  collected_at: string;
  n: number;
  mean: number | null;
}

/** Dashboard state object */
interface DashboardState {
  site: SiteDetail | null;
  parameters: Set<string>;
  parametersWithData: Set<string>;
  parameterTypeOrder: string[];
  expandedCharts: Set<string>;
  start: Date | null;
  end: Date | null;
  dataMinTs: number | null;
  dataMaxTs: number | null;
  charts: Record<string, uPlot>;
  chartData: Record<string, ChartDataEntry>;
  slider: ReturnType<typeof noUiSlider.create> | null;
  data: ReadingsData | null;
  grabData: ReadingsData | null;
  samplesLookup: Map<string, SampleRecord>;
  alarms: AlarmBand[];
  showAlarms: boolean;
  singlePoint: boolean;
  parametersCollapsed: boolean;
  gapThreshold: number;
}

type ApiFn = (url: string, noCache?: boolean) => Promise<unknown>;
type AuthFetchFn = (url: string) => Promise<Response>;

const DASHBOARD_HTML = `
<div class="container">
  <header>
    <h1>River Data</h1>
    <div class="site-groups" id="site-groups">
      <span style="color: var(--muted); font-size: 0.875rem">Loading...</span>
    </div>
  </header>

  <div class="slider-section" id="slider-section" style="display: none">
    <div class="slider-labels">
      <span id="min-date">--</span>
      <span id="max-date">--</span>
    </div>
    <div id="time-slider"></div>
    <div class="timeline-legend" id="timeline-legend">
      <div class="timeline-region-history" id="region-history"></div>
      <div class="timeline-region-week" id="region-week"></div>
      <div class="timeline-region-today" id="region-today"></div>
    </div>
    <div class="timeline-labels" id="timeline-labels">
      <span id="label-history" style="color: ${tokens.brand.textMuted}"></span>
      <span id="label-week" style="color: ${tokens.brand.primary}"></span>
      <span id="label-today" style="color: ${tokens.severity.ok.main}"></span>
    </div>
    <div class="slider-info">
      <div>
        <span class="window-info" id="window-info">--</span>
        <span class="resolution-info" id="resolution-info"></span>
      </div>
    </div>
  </div>

  <div class="controls-row">
    <div class="parameter-toggles" id="parameter-toggles">
      <span style="color: var(--muted); font-size: 0.875rem">Select a site to see parameters</span>
    </div>
    <button class="alarm-toggle active" id="alarm-toggle">
      <span class="alarm-indicator"></span>
      <span id="alarm-count">Alarms</span>
    </button>
  </div>

  <div class="export-toolbar" id="export-toolbar" style="display: none">
    <div class="export-toolbar-left">
      <a id="site-hub-link" class="site-hub-link" href="#">View site details</a>
    </div>
    <div class="export-toolbar-right">
      <button class="export-btn" id="export-csv-btn" title="Download readings as CSV">Export CSV</button>
      <button class="export-btn" id="export-ndjson-btn" title="Download readings as NDJSON">Export NDJSON</button>
    </div>
  </div>

  <div class="charts-container" id="charts-container">
    <div class="chart-placeholder">Select a site to view data</div>
  </div>

  <div class="chart-footer">
    <div class="footer-left">
      <a href="/docs">API Docs</a>
      <span class="footer-separator">|</span>
      <a href="https://github.com/RIVER-EPFL/river-data-api" target="_blank" rel="noopener">Source</a>
    </div>
    <div class="chart-hint">Drag to zoom &middot; Double-click to reset</div>
    <div class="footer-right">
      <span>
        Developed by <a href="https://github.com/evanjt" target="_blank" rel="noopener">Evan Thomas</a>
        at <a href="https://www.epfl.ch/research/domains/alpole/" target="_blank" rel="noopener">ALPOLE</a>,
        <a href="https://www.epfl.ch/about/campus/fr/valais-fr/" target="_blank" rel="noopener">EPFL Valais</a>
      </span>
    </div>
  </div>
</div>

<div class="hover-tooltip" id="hover-tooltip">
  <div class="tooltip-time" id="tooltip-time">--</div>
  <div id="tooltip-values"></div>
</div>
`;

export interface DashboardOptions {
  /** When set, skip the header/site-selector and load this site immediately */
  siteId?: string;
  /** Hide the header (project/site buttons) but keep them in the DOM so selectSite() works */
  hideHeader?: boolean;
  /** Don't auto-load the first site on init */
  skipAutoLoad?: boolean;
}

export interface DashboardHandle {
  destroy: () => void;
  selectSite: (siteId: string) => void;
  clearSite: () => void;
}

export function createDashboard(root: HTMLElement, api: ApiFn, authFetch: AuthFetchFn, options?: DashboardOptions): DashboardHandle {
  root.innerHTML = DASHBOARD_HTML;

  const ac = new AbortController();
  const { signal } = ac;

  // Tooltip hide debounce (prevents flicker when cursor moves between synced charts)
  let hideRaf: number | null = null;

  // Scoped DOM query helper
  const $ = (id: string) => root.querySelector(`#${id}`) as HTMLElement;

  // Sanitize parameter type names for use as CSS IDs (spaces, parens, slashes, etc.)
  const cssId = (type: string) => 'chart-' + type.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

  // State
  const state: DashboardState = {
    site: null,
    parameters: new Set(),
    parametersWithData: new Set(),
    parameterTypeOrder: [],
    expandedCharts: new Set(),
    start: null,
    end: null,
    dataMinTs: null,
    dataMaxTs: null,
    charts: {},
    chartData: {},
    slider: null,
    data: null,
    grabData: null,
    samplesLookup: new Map(),
    alarms: [],
    showAlarms: true,
    singlePoint: false,
    parametersCollapsed: true,
    gapThreshold: 0,
  };

  const CHART_HEIGHT_NORMAL = 180;
  const CHART_HEIGHT_EXPANDED = 400;

  const syncKey = uPlot.sync('parameters');

  // DOM elements (scoped to root)
  const tooltip = $('hover-tooltip');
  const tooltipTime = $('tooltip-time');
  const tooltipValues = $('tooltip-values');

  // Color palette (Okabe-Ito, colorblind-safe — from theme tokens)
  const colors = tokens.dataViz;
  const parameterColors: Record<string, string> = {};

  const alarmColors: Record<number, string> = {
    0: tokens.severity.unknown.soft,
    1: tokens.severity.warning.soft,
    2: tokens.severity.alarm.soft,
  };
  const alarmBorderColors: Record<number, string> = {
    0: tokens.severity.unknown.border,
    1: tokens.severity.warning.border,
    2: tokens.severity.alarm.border,
  };

  function alarmBandsPlugin(paramType: string) {
    return {
      hooks: {
        draw: [(u: uPlot) => {
          if (!state.showAlarms || !state.alarms.length) return;
          const ctx = u.ctx;
          const { left, top, width, height } = u.bbox;
          const [xMin, xMax] = [u.scales.x.min!, u.scales.x.max!];

          state.alarms.forEach((alarm) => {
            if (alarm.parameter_type !== paramType) return;
            const startTs = new Date(alarm.when_on).getTime() / 1000;
            const endTs = alarm.when_off
              ? new Date(alarm.when_off).getTime() / 1000
              : Math.min(Date.now() / 1000, xMax);
            if (endTs < xMin || startTs > xMax) return;
            const x1 = u.valToPos(Math.max(startTs, xMin), 'x', true);
            const x2 = u.valToPos(Math.min(endTs, xMax), 'x', true);
            ctx.fillStyle = alarmColors[alarm.severity] || alarmColors[1];
            ctx.fillRect(x1, top, x2 - x1, height);
            ctx.strokeStyle = alarmBorderColors[alarm.severity] || alarmBorderColors[1];
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, top);
            ctx.lineTo(x1, top + height);
            ctx.stroke();
          });
        }],
      },
    };
  }

  function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: T) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  }

  async function downloadExport(siteId: string, format: 'csv' | 'ndjson', start: string, end: string) {
    const url = `/api/sites/${siteId}/readings?format=${format}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    try {
      const res = await authFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `readings.${format === 'csv' ? 'csv' : 'ndjson'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      console.error('Export failed:', e);
    }
  }

  function updateExportToolbar() {
    const toolbar = $('export-toolbar');
    const hubLink = $('site-hub-link') as HTMLAnchorElement;
    if (!state.site) {
      toolbar.style.display = 'none';
      return;
    }
    toolbar.style.display = '';
    hubLink.href = '#';
    hubLink.setAttribute('data-navigate', `/admin/sites/${state.site.id}/show`);
    hubLink.textContent = 'View site details';
  }

  function formatDate(ts: number) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function formatDateTimeFull(ts: number) {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatDuration(ms: number) {
    const days = Math.round(ms / 86400000);
    if (days < 1) return 'Less than 1 day';
    if (days === 1) return '1 day';
    if (days < 7) return `${days} days`;
    if (days < 30) return `${Math.round(days / 7)} week${days >= 14 ? 's' : ''}`;
    if (days < 365) return `${Math.round(days / 30)} month${days >= 60 ? 's' : ''}`;
    return `${(days / 365).toFixed(1)} years`;
  }

  // Single-site mode: hide header and site-hub link
  const singleSiteMode = !!options?.siteId;
  if (singleSiteMode) {
    const header = root.querySelector('header');
    if (header) (header as HTMLElement).style.display = 'none';
    const hubLink = $('site-hub-link');
    if (hubLink) hubLink.style.display = 'none';
  }

  // Hide header but keep buttons in the DOM so selectSite() still works
  if (options?.hideHeader) {
    const header = root.querySelector('header');
    if (header) (header as HTMLElement).style.display = 'none';
  }

  // Initialize
  async function init() {
    if (singleSiteMode) {
      // Skip project/site fetching, go straight to the site
      initControls();
      loadSite(options!.siteId!);
      return;
    }

    const [projects, sites] = await Promise.all([
      api('/api/projects') as Promise<DashboardProject[]>,
      api('/api/sites') as Promise<DashboardSite[]>,
    ]);

    const container = $('site-groups');

    const sitesByProject: Record<string, DashboardSite[]> = {};
    sites.forEach((s) => {
      const projectId = s.project_id || 'unknown';
      if (!sitesByProject[projectId]) sitesByProject[projectId] = [];
      sitesByProject[projectId].push(s);
    });

    let html = '';
    projects.forEach((project) => {
      const projectSites = sitesByProject[project.id] || [];
      if (projectSites.length === 0) return;
      html += `
        <div class="project-group">
          <div class="project-label">${project.name}</div>
          <div class="project-sites">
            ${projectSites.map((s) => `
              <button class="site-btn" data-id="${s.id}">${s.name}</button>
            `).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.site-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.site-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        loadSite((btn as HTMLElement).dataset.id!);
      }, { signal });
    });

    initControls();

    // Auto-load first site (unless caller handles site selection)
    if (!options?.skipAutoLoad) {
      const firstBtn = container.querySelector('.site-btn') as HTMLElement | null;
      if (firstBtn) firstBtn.click();
    }
  }

  function initControls() {
    // Alarm toggle handler
    $('alarm-toggle').addEventListener('click', () => {
      state.showAlarms = !state.showAlarms;
      $('alarm-toggle').classList.toggle('active', state.showAlarms);
      Object.values(state.charts).forEach((c) => c.redraw());
    }, { signal });

    // Export button handlers
    $('export-csv-btn').addEventListener('click', () => {
      if (!state.site || !state.start || !state.end) return;
      downloadExport(state.site.id, 'csv', state.start.toISOString(), state.end.toISOString());
    }, { signal });

    $('export-ndjson-btn').addEventListener('click', () => {
      if (!state.site || !state.start || !state.end) return;
      downloadExport(state.site.id, 'ndjson', state.start.toISOString(), state.end.toISOString());
    }, { signal });
  }

  async function loadSite(siteId: string) {
    const site = await api(`/api/sites/${siteId}/detail`, true) as SiteDetail;
    state.site = site;
    updateExportToolbar();

    Object.values(state.charts).forEach((chart) => chart.destroy());
    state.charts = {};
    state.chartData = {};
    const chartsEl = $('charts-container');
    chartsEl.style.minHeight = chartsEl.offsetHeight + 'px';
    chartsEl.innerHTML = '';

    const toggles = $('parameter-toggles');
    const types = [...new Set((site.parameters || []).map((s) => s.sensor_type || s.name).filter(Boolean))].sort() as string[];

    if (!types.length) {
      toggles.innerHTML = '<span style="color: var(--muted); font-size: 0.875rem;">No parameters configured</span>';
      state.parameters = new Set();
      $('charts-container').innerHTML = '<div class="chart-placeholder">No parameters configured</div>';
      $('charts-container').style.minHeight = '';
      return;
    }

    types.forEach((t, i) => parameterColors[t] = colors[i % colors.length]);
    state.parameters = new Set(types);
    state.parameterTypeOrder = types;

    // Don't render toggles yet — updateCharts will render only types with data
    toggles.innerHTML = '<span style="color: var(--muted); font-size: 0.875rem">Loading…</span>';

    if (!site.data_start || !site.data_end) {
      ($('slider-section')).style.display = 'none';
      $('charts-container').innerHTML = '<div class="chart-placeholder">No data available for this site</div>';
      $('charts-container').style.minHeight = '';
      return;
    }

    const minTs = new Date(site.data_start).getTime();
    const maxTs = new Date(site.data_end).getTime();
    state.dataMinTs = minTs;
    state.dataMaxTs = maxTs;

    $('min-date').textContent = formatDate(minTs);
    $('max-date').textContent = formatDate(maxTs);
    ($('slider-section')).style.display = 'block';

    const sliderEl = $('time-slider');
    if (state.slider) {
      state.slider.destroy();
      state.slider = null;
    }

    // Single-point data: show static label instead of slider
    if (minTs === maxTs) {
      state.singlePoint = true;
      sliderEl.style.display = 'none';
      $('min-date').textContent = '';
      $('max-date').textContent = '';
      ($('timeline-legend') as HTMLElement).style.display = 'none';
      ($('timeline-labels') as HTMLElement).style.display = 'none';
      $('window-info').textContent = `Single measurement · ${formatDateTimeFull(minTs)}`;
      $('resolution-info').textContent = '';
      state.start = new Date(minTs - 300000);
      state.end = new Date(maxTs + 300000);
      fetchData();
      return;
    }

    state.singlePoint = false;
    sliderEl.style.display = '';
    ($('timeline-legend') as HTMLElement).style.display = '';
    ($('timeline-labels') as HTMLElement).style.display = '';

    state.start = new Date(minTs);
    state.end = new Date(maxTs);

    const rangeDays = (maxTs - minTs) / 86400000;
    const oneDayMs = 86400000;
    const oneWeekMs = 7 * oneDayMs;

    const todayStart = maxTs - oneDayMs;
    const weekStart = maxTs - oneWeekMs;

    let sliderRange: NoUiSliderOptions['range'];
    let pipsConfig: NoUiSliderOptions['pips'];
    const zoneHistory = $('region-history');
    const zoneWeek = $('region-week');
    const zoneToday = $('region-today');
    const labelHistory = $('label-history');
    const labelWeek = $('label-week');
    const labelToday = $('label-today');

    zoneHistory.style.display = '';
    zoneWeek.style.display = '';
    zoneToday.style.display = '';
    labelHistory.style.display = '';
    labelWeek.style.display = '';
    labelToday.style.display = '';

    if (rangeDays > 8) {
      sliderRange = { 'min': minTs, '50%': weekStart, '80%': todayStart, 'max': maxTs };
      zoneHistory.style.width = '50%';
      zoneWeek.style.width = '30%';
      zoneToday.style.width = '20%';
      labelHistory.style.width = '50%';
      labelWeek.style.width = '30%';
      labelToday.style.width = '20%';
      labelHistory.textContent = 'History';
      labelWeek.textContent = 'Last week';
      labelToday.textContent = 'Last day';
      pipsConfig = {
        mode: PipsMode.Positions,
        values: [0, 25, 50, 65, 80, 90, 100],
        density: 100,
        format: {
          to: (v: number) => {
            const d = new Date(v);
            const hoursFromEnd = (maxTs - v) / 3600000;
            if (hoursFromEnd <= 24) {
              const h = d.getHours();
              if (h === 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              if (h === 6 || h === 12 || h === 18) return h + ':00';
              return '';
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          },
        },
      };
    } else if (rangeDays > 2) {
      sliderRange = { 'min': minTs, '70%': todayStart, 'max': maxTs };
      zoneHistory.style.width = '0%';
      zoneHistory.style.display = 'none';
      labelHistory.style.display = 'none';
      zoneWeek.style.width = '70%';
      zoneToday.style.width = '30%';
      labelWeek.style.width = '70%';
      labelToday.style.width = '30%';
      labelWeek.textContent = 'This week';
      labelToday.textContent = 'Last day';
      pipsConfig = {
        mode: PipsMode.Positions,
        values: [0, 20, 40, 60, 85, 100],
        format: {
          to: (v: number) => {
            const d = new Date(v);
            const hoursFromEnd = (maxTs - v) / 3600000;
            if (hoursFromEnd <= 24) {
              const h = d.getHours();
              if (h === 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              if (h === 12) return '12:00';
              return '';
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          },
        },
      };
    } else {
      sliderRange = { min: minTs, max: maxTs };
      zoneHistory.style.display = 'none';
      zoneWeek.style.display = 'none';
      zoneToday.style.width = '100%';
      labelHistory.style.display = 'none';
      labelWeek.style.display = 'none';
      labelToday.style.width = '100%';
      labelToday.textContent = 'All data';
      pipsConfig = {
        mode: PipsMode.Count,
        values: 6,
        format: {
          to: (v: number) => {
            const d = new Date(v);
            if (rangeDays < 1) {
              return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            }
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          },
        },
      };
    }

    state.slider = noUiSlider.create(sliderEl, {
      start: [state.start.getTime(), state.end.getTime()],
      connect: true,
      range: sliderRange,
      step: 600000,
      tooltips: [
        { to: (v: number) => formatDateTimeFull(v) },
        { to: (v: number) => formatDateTimeFull(v) },
      ],
      pips: pipsConfig,
    });

    state.slider.on('update', (values: (string | number)[]) => {
      const lo = state.dataMinTs ?? minTs;
      const hi = state.dataMaxTs ?? maxTs;
      const startTs = Math.min(Math.max(Number(values[0]), lo), hi);
      const endTs = Math.min(Math.max(Number(values[1]), lo), hi);
      state.start = new Date(startTs);
      state.end = new Date(endTs);
      updateWindowInfo();
      fetchData();
    });

    sliderEl.addEventListener('dragstart', (e) => e.preventDefault(), { signal });
    sliderEl.addEventListener('selectstart', (e) => e.preventDefault(), { signal });

    updateWindowInfo();
    fetchData();
  }

  function updateWindowInfo() {
    if (!state.start || !state.end) return;
    const duration = state.end.getTime() - state.start.getTime();
    $('window-info').textContent = `Showing: ${formatDuration(duration)}`;
  }

  function mergeTimelines(
    mainTimes: number[],
    grabTimes: number[],
  ): { times: number[]; mainAt: (number | null)[]; grabAt: (number | null)[] } {
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

  function remapValues(
    source: (number | null | undefined)[],
    indexMap: (number | null)[],
  ): (number | null)[] {
    return indexMap.map((idx) => (idx != null ? (source[idx] ?? null) : null));
  }

  function grabSampleDiamondsPlugin(seriesIdx: number): uPlot.Plugin {
    return {
      hooks: {
        draw: [
          (u: uPlot) => {
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
            ctx.fillStyle = uPlotTheme.grabSampleFill;
            ctx.strokeStyle = uPlotTheme.grabSampleStroke;
            ctx.lineWidth = 1.5;

            for (let i = 0; i < xData.length; i++) {
              const val = data[i];
              if (val == null) continue;
              const x = u.valToPos(xData[i], 'x', true);
              const y = u.valToPos(val as number, 'y', true);

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
    };
  }

  function buildSamplesLookup(samples: SampleRecord[]): Map<string, SampleRecord> {
    const lookup = new Map<string, SampleRecord>();
    for (const s of samples) {
      lookup.set(s.collected_at, s);
    }
    return lookup;
  }

  const fetchData = debounce(async () => {
    if (!state.site || !state.start || !state.end) return;

    const days = (state.end.getTime() - state.start.getTime()) / 86400000;
    let endpoint: string, resolution: string;

    if (days <= 14) {
      endpoint = 'readings';
      resolution = '10-min raw';
      state.gapThreshold = GAP_THRESHOLDS.raw;
    } else if (days <= 120) {
      endpoint = 'aggregates/hourly';
      resolution = 'hourly avg';
      state.gapThreshold = GAP_THRESHOLDS.hourly;
    } else if (days <= 1095) {
      endpoint = 'aggregates/daily';
      resolution = 'daily avg';
      state.gapThreshold = GAP_THRESHOLDS.daily;
    } else {
      endpoint = 'aggregates/weekly';
      resolution = 'weekly avg';
      state.gapThreshold = GAP_THRESHOLDS.weekly;
    }

    const url = `/api/sites/${state.site.id}/${endpoint}?start=${state.start.toISOString()}&end=${state.end.toISOString()}&alarms=true`;
    const grabUrl = `/api/sites/${state.site.id}/readings?start=${state.start.toISOString()}&end=${state.end.toISOString()}&measurement_type=spot`;
    const samplesUrl = `/api/samples?filter=${encodeURIComponent(JSON.stringify({ site_id: state.site.id }))}&range=[0,999]&sort=["collected_at","DESC"]`;

    showLoading();

    try {
      const [data, grabData, samplesRes] = await Promise.all([
        api(url) as Promise<ReadingsData>,
        (api(grabUrl) as Promise<ReadingsData>).catch(() => ({ times: [], parameters: [] } as ReadingsData)),
        authFetch(samplesUrl).then(r => r.ok ? r.json() : []).catch(() => []) as Promise<SampleRecord[]>,
      ]);

      let mainData = data;
      if (!mainData.times?.length && endpoint !== 'readings') {
        const fallbackUrl = `/api/sites/${state.site.id}/readings?start=${state.start.toISOString()}&end=${state.end.toISOString()}&alarms=true`;
        mainData = await api(fallbackUrl) as ReadingsData;
        resolution = '10-min raw (fallback)';
      }

      state.data = mainData;
      state.grabData = grabData.times?.length ? grabData : null;
      state.samplesLookup = buildSamplesLookup(samplesRes);
      $('resolution-info').textContent = state.singlePoint ? '' : `(${resolution})`;
      state.alarms = extractAlarmsFromData(mainData);
      updateAlarmCount();
      updateCharts();
    } catch (e) {
      console.error('Failed to fetch data:', e);
      $('charts-container').innerHTML = '<div class="chart-placeholder">Error loading data</div>';
      $('charts-container').style.minHeight = '';
    } finally {
      hideLoading();
    }
  }, 100);

  function extractAlarmsFromData(data: ReadingsData | null): AlarmBand[] {
    if (!data?.times?.length || !data?.parameters?.length) return [];
    const alarms: AlarmBand[] = [];

    data.parameters.forEach((param) => {
      const sevs = param.severities || param.max_severity;
      if (!sevs) return;
      let currentAlarm: AlarmBand | null = null;

      for (let i = 0; i < data.times.length; i++) {
        const severity = sevs[i] || 0;
        const time = data.times[i];
        if (severity > 0) {
          if (!currentAlarm || currentAlarm.severity !== severity) {
            if (currentAlarm) {
              currentAlarm.when_off = data.times[i - 1];
              alarms.push(currentAlarm);
            }
            currentAlarm = {
              when_on: time,
              when_off: null,
              severity,
              parameter_id: param.id,
              parameter_name: param.display_name || param.name,
              parameter_type: param.type,
            };
          }
        } else if (currentAlarm) {
          currentAlarm.when_off = data.times[i - 1];
          alarms.push(currentAlarm);
          currentAlarm = null;
        }
      }

      if (currentAlarm) {
        currentAlarm.when_off = data.times[data.times.length - 1];
        alarms.push(currentAlarm);
      }
    });

    return alarms;
  }

  function updateAlarmCount() {
    const countEl = $('alarm-count');
    if (countEl) {
      const count = state.alarms.length;
      countEl.textContent = count > 0 ? `Alarms (${count})` : 'Alarms';
    }
  }

  function showLoading() {
    const info = $('resolution-info');
    if (info && !info.querySelector('.loading-spinner')) {
      info.insertAdjacentHTML('beforeend', '<span class="loading-spinner"></span>');
    }
  }

  function hideLoading() {
    const spinner = root.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
  }

  function hasData(param: ReadingsParameter) {
    const values = param.values || param.avg || [];
    return values.some((v) => v != null);
  }

  function updateTooltip(idx: number | null, mouseX: number, mouseY: number) {
    if (idx == null || !state.data?.times?.length) {
      tooltip.classList.remove('visible');
      return;
    }

    let timeMs: number | undefined;
    for (const type of state.parameterTypeOrder) {
      if (state.chartData[type]?.timestamps[idx] != null) {
        timeMs = state.chartData[type].timestamps[idx] * 1000;
        break;
      }
    }
    const time = timeMs != null ? new Date(timeMs) : new Date(state.data.times[idx]);
    tooltipTime.textContent = time.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    let html = '';
    state.parameterTypeOrder.forEach((type: string) => {
      if (!state.parameters.has(type) || !state.chartData[type]) return;
      const { params } = state.chartData[type];
      params.forEach((param) => {
        const values = param.values || param.avg || [];
        const val = values[idx];
        const color = parameterColors[type] || tokens.brand.textMuted;
        const sevs = param.severities || param.max_severity;
        const sev = (sevs && state.showAlarms) ? (sevs[idx] || 0) : 0;
        const badge = sev > 0 ? `<span class="alarm-badge ${sev === 2 ? 'critical' : 'warning'}">${sev === 2 ? 'ALARM' : 'WARN'}</span>` : '';
        html += `<div class="tooltip-row">
          <span class="tooltip-label" style="color: ${color}">${param.display_name || param.name} ${badge}</span>
          <span class="tooltip-value">${val != null ? val.toFixed(2) : '--'} ${param.units || ''}</span>
        </div>`;
      });

      // Show grab sample values for this parameter type at the hovered timestamp
      const grabParams = state.grabData?.parameters?.filter((p) => p.type === type) ?? [];
      grabParams.forEach((gp) => {
        const grabTimes = state.grabData?.times ?? [];
        const grabValues = gp.values || [];
        // Find the grab sample at this merged timestamp index
        const mergedTs = state.chartData[type]?.timestamps;
        if (!mergedTs) return;
        const hoveredTs = mergedTs[idx];
        if (hoveredTs == null) return;
        const grabTimeIdx = grabTimes.findIndex((t) => Math.abs(new Date(t).getTime() / 1000 - hoveredTs) < 1);
        if (grabTimeIdx < 0 || grabValues[grabTimeIdx] == null) return;

        const grabVal = grabValues[grabTimeIdx];
        const sample = state.samplesLookup.get(grabTimes[grabTimeIdx]);
        const replicateBadge = sample && sample.n > 1
          ? `<span class="tooltip-grab-badge">${sample.n} replicates</span>`
          : '';

        html += `<div class="tooltip-row">
          <span class="tooltip-label" style="color: ${tokens.markers.grabSample.stroke}">&#x25C6; ${gp.display_name || gp.name} (grab) ${replicateBadge}</span>
          <span class="tooltip-value">${grabVal != null ? grabVal.toFixed(2) : '--'} ${gp.units || ''}</span>
        </div>`;
      });
    });

    tooltipValues.innerHTML = html;
    tooltip.classList.add('visible');

    const rect = tooltip.getBoundingClientRect();
    let left = mouseX + 20;
    let top = mouseY + 20;
    if (left + rect.width > window.innerWidth - 10) left = mouseX - rect.width - 20;
    if (top + rect.height > window.innerHeight - 10) top = mouseY - rect.height - 20;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  function updateCharts() {
    const chartsContainer = $('charts-container');

    if (!state.data || !state.data.times?.length) {
      chartsContainer.innerHTML = '<div class="chart-placeholder">No data for selected range</div>';
      Object.values(state.charts).forEach((chart) => chart.destroy());
      state.charts = {};
      state.chartData = {};
      return;
    }

    const { times, parameters } = state.data;
    let timestamps = times.map((t) => new Date(t).getTime() / 1000);

    // Single-point data: uPlot cannot render a line from 1 point.
    // Pad with a synthetic point 1 second later so the chart has a valid range,
    // using null values for the padded point so no false line is drawn.
    const isSingleTimestamp = timestamps.length === 1;
    if (isSingleTimestamp) {
      timestamps = [timestamps[0] - 1, timestamps[0], timestamps[0] + 1];
      parameters.forEach((param) => {
        if (param.values) param.values = [null, param.values[0], null];
        if (param.avg) param.avg = [null, param.avg[0], null];
        if (param.severities) param.severities = [null, param.severities[0], null];
        if (param.max_severity) param.max_severity = [null, param.max_severity[0], null];
      });
    }

    const paramsByType: Record<string, ReadingsParameter[]> = {};
    state.parametersWithData.clear();

    parameters.forEach((param) => {
      if (!hasData(param)) return;
      if (!paramsByType[param.type]) paramsByType[param.type] = [];
      paramsByType[param.type].push(param);
      state.parametersWithData.add(param.type);
    });

    // Update parameter toggles (only show types that have data)
    const toggles = $('parameter-toggles');
    const typesWithData = [...new Set(parameters.map((s) => s.type))].filter((t) => state.parametersWithData.has(t)).sort();
    const enabledCount = typesWithData.filter((t) => state.parameters.has(t)).length;

    if (!typesWithData.length) {
      toggles.innerHTML = '<span style="color: var(--muted); font-size: 0.875rem">No data available</span>';
    } else {
      const isCollapsed = state.parametersCollapsed;
      toggles.innerHTML = `
        <div class="parameter-toggles-summary" id="parameter-toggles-summary">
          <span class="parameter-toggles-count">${enabledCount} of ${typesWithData.length} parameters showing</span>
          <span class="parameter-toggles-arrow">${isCollapsed ? '▼' : '▲'}</span>
        </div>
        <div class="parameter-toggles-list" id="parameter-toggles-list" style="display: ${isCollapsed ? 'none' : 'flex'}">
          ${typesWithData.map((t) => {
            const checked = state.parameters.has(t);
            return `<label class="parameter-toggle">
              <input type="checkbox" value="${t}" ${checked ? 'checked' : ''}>
              <span style="color: ${parameterColors[t]}">${t}</span>
            </label>`;
          }).join('')}
        </div>
      `;

      $('parameter-toggles-summary').addEventListener('click', () => {
        state.parametersCollapsed = !state.parametersCollapsed;
        const list = $('parameter-toggles-list');
        const arrow = toggles.querySelector('.parameter-toggles-arrow');
        if (list) list.style.display = state.parametersCollapsed ? 'none' : 'flex';
        if (arrow) arrow.textContent = state.parametersCollapsed ? '▼' : '▲';
      }, { signal });
    }

    toggles.querySelectorAll('.parameter-toggles-list input').forEach((cb) => {
      cb.addEventListener('change', () => {
        const input = cb as HTMLInputElement;
        if (input.checked) state.parameters.add(input.value);
        else state.parameters.delete(input.value);
        updateCharts();
      }, { signal });
    });

    const enabledTypes = [...state.parameters].filter((t: string) => state.parametersWithData.has(t)).sort();

    if (!enabledTypes.length) {
      chartsContainer.innerHTML = '<div class="chart-placeholder">No data available for selected parameters</div>';
      Object.values(state.charts).forEach((chart) => chart.destroy());
      state.charts = {};
      state.chartData = {};
      return;
    }

    // Remove charts for disabled/empty types
    Object.keys(state.charts).forEach((type) => {
      if (!enabledTypes.includes(type)) {
        state.charts[type].destroy();
        delete state.charts[type];
        delete state.chartData[type];
        const el = root.querySelector(`#${cssId(type)}`);
        if (el) el.remove();
      }
    });

    const chartWidth = chartsContainer.clientWidth - 32;

    enabledTypes.forEach((type: string) => {
      const typeParams = paramsByType[type] || [];
      if (!typeParams.length) return;

      let chartDiv = root.querySelector(`#${cssId(type)}`) as HTMLElement | null;
      const isExpanded = state.expandedCharts.has(type);
      const chartHeight = isExpanded ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT_NORMAL;

      if (!chartDiv) {
        chartDiv = document.createElement('div');
        chartDiv.id = cssId(type);
        chartDiv.className = 'parameter-chart';
        const siteHubHref = state.site ? `#/sites/${state.site.id}/show` : '#';
        chartDiv.innerHTML = `
          <a class="chart-label chart-label-link" style="color: ${parameterColors[type]}" href="${siteHubHref}">${type} (${typeParams[0]?.units || ''})</a>
          <div class="chart-area"></div>
          <button class="chart-expand" data-type="${type}" title="Expand/collapse chart">\u2922</button>
        `;

        const currentIndex = enabledTypes.indexOf(type);
        let insertBefore: HTMLElement | null = null;
        for (let i = currentIndex + 1; i < enabledTypes.length; i++) {
          const nextChart = root.querySelector(`#${cssId(enabledTypes[i])}`) as HTMLElement | null;
          if (nextChart) {
            insertBefore = nextChart;
            break;
          }
        }
        if (insertBefore) {
          chartsContainer.insertBefore(chartDiv, insertBefore);
        } else {
          chartsContainer.appendChild(chartDiv);
        }

        chartDiv.querySelector('.chart-expand')!.addEventListener('click', (e) => {
          const t = (e.target as HTMLElement).dataset.type!;
          if (state.expandedCharts.has(t)) {
            state.expandedCharts.delete(t);
          } else {
            state.expandedCharts.add(t);
          }
          updateCharts();
        }, { signal });

        chartDiv.querySelector('.chart-area')!.addEventListener('dblclick', () => {
          if (state.dataMinTs == null || state.dataMaxTs == null || !state.slider) return;
          state.slider.set([state.dataMinTs, state.dataMaxTs]);
        }, { signal });
      }

      const chartArea = chartDiv.querySelector('.chart-area')!;
      const expandBtn = chartDiv.querySelector('.chart-expand')!;
      expandBtn.textContent = isExpanded ? '\u2921' : '\u2922';
      (expandBtn as HTMLElement).title = isExpanded ? 'Collapse chart' : 'Expand chart';

      // Collect grab sample data for this parameter type
      const grabParams = state.grabData?.parameters?.filter((p) => p.type === type) ?? [];
      const grabTimesRaw = grabParams.length > 0 && state.grabData?.times?.length
        ? state.grabData.times.map((t) => new Date(t).getTime() / 1000)
        : [];
      const hasGrab = grabTimesRaw.length > 0;

      // Merge grab sample timestamps into the main timeline
      const { times: mergedTimes, mainAt, grabAt } = hasGrab
        ? mergeTimelines(timestamps, grabTimesRaw)
        : { times: timestamps, mainAt: timestamps.map((_, i) => i), grabAt: timestamps.map(() => null) };

      state.chartData[type] = { params: typeParams, timestamps: mergedTimes };

      const seriesData: uPlot.AlignedData = [mergedTimes];
      const seriesOpts: uPlot.Series[] = [{}];
      const gaps = state.gapThreshold > 0 ? makeGaps(state.gapThreshold) : undefined;

      typeParams.forEach((param) => {
        const rawValues = param.values || param.avg || [];
        const values = hasGrab ? remapValues(rawValues, mainAt) : rawValues;
        (seriesData as (number | null)[][]).push(values);
        seriesOpts.push({
          label: param.display_name || param.name,
          stroke: parameterColors[type] || tokens.brand.textMuted,
          width: 1.5,
          points: isSingleTimestamp ? { show: true, size: 8 } : undefined,
          value: (_u: uPlot, v: number | null) => v == null ? '--' : v.toFixed(2) + (param.units ? ' ' + param.units : ''),
          gaps,
        });
      });

      // Add grab sample series (one per grab parameter matching this type)
      const plugins: uPlot.Plugin[] = [alarmBandsPlugin(type)];
      if (hasGrab) {
        grabParams.forEach((gp) => {
          const rawGrabValues = gp.values || [];
          const grabValues = remapValues(rawGrabValues, grabAt);
          (seriesData as (number | null)[][]).push(grabValues);
          const grabSeriesIdx = seriesData.length - 1;
          seriesOpts.push({
            label: `${gp.display_name || gp.name} (grab)`,
            stroke: tokens.markers.grabSample.fill,
            width: 0,
            points: { show: false },
          });
          plugins.push(grabSampleDiamondsPlugin(grabSeriesIdx));
        });
      }

      const existing = state.charts[type];
      if (existing && existing.series.length === seriesOpts.length) {
        existing.setData(seriesData);
        if (existing.width !== chartWidth || existing.height !== chartHeight) {
          existing.setSize({ width: chartWidth, height: chartHeight });
        }
      } else {
        if (existing) existing.destroy();
        (chartArea as HTMLElement).innerHTML = '';

        const opts: uPlot.Options = {
          width: chartWidth,
          height: chartHeight,
          padding: [10, 10, 0, 0],
          scales: { x: { time: true }, y: { auto: true } },
          axes: [
            { stroke: tokens.brand.textMuted, grid: { stroke: tokens.brand.divider }, size: 50 },
            {
              stroke: parameterColors[type],
              grid: { stroke: tokens.brand.divider },
              size: 50,
              values: (_u: uPlot, vals: number[]) => vals.map((v) => v == null ? '' : v.toFixed(1)),
            },
          ],
          series: seriesOpts,
          cursor: {
            sync: { key: syncKey.key, setSeries: true },
            drag: { x: true, y: false },
          },
          plugins,
          hooks: {
            setCursor: [
              (u: uPlot) => {
                const idx = u.cursor.idx;
                if (idx != null) {
                  if (hideRaf != null) { cancelAnimationFrame(hideRaf); hideRaf = null; }
                  const bbox = u.root.getBoundingClientRect();
                  const cx = u.cursor.left! + bbox.left;
                  const cy = u.cursor.top! + bbox.top;
                  updateTooltip(idx, cx, cy);
                } else {
                  hideRaf = requestAnimationFrame(() => { hideTooltip(); hideRaf = null; });
                }
              },
            ],
            setSelect: [
              (u: uPlot) => {
                if (u.select.width > 0) {
                  const left = u.posToVal(u.select.left, 'x');
                  const right = u.posToVal(u.select.left + u.select.width, 'x');
                  const lo = state.dataMinTs ?? -Infinity;
                  const hi = state.dataMaxTs ?? Infinity;
                  const selStart = Math.min(Math.max(left * 1000, lo), hi);
                  const selEnd = Math.min(Math.max(right * 1000, lo), hi);
                  state.slider?.set([selStart, selEnd]);
                  u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
                }
              },
            ],
          },
          legend: { show: false },
        };

        state.charts[type] = new uPlot(opts, seriesData, chartArea as HTMLElement);

        // Attach dblclick to uPlot root (u-over div may absorb events on .chart-area)
        state.charts[type].root.addEventListener('dblclick', () => {
          if (state.dataMinTs == null || state.dataMaxTs == null || !state.slider) return;
          state.slider.set([state.dataMinTs, state.dataMaxTs]);
        }, { signal });
      }
    });

    // Remove placeholder if we have charts
    const placeholder = chartsContainer.querySelector('.chart-placeholder');
    if (placeholder && enabledTypes.length) placeholder.remove();

    // Clear minHeight lock now that charts are rendered
    chartsContainer.style.minHeight = '';
  }

  // Event listeners
  $('charts-container').addEventListener('mouseleave', () => {
    hideTooltip();
  }, { signal });

  // Resize charts when container changes size (handles grid layout changes, not just window resize)
  const resizeCharts = debounce(() => {
    const chartsContainer = $('charts-container');
    const width = chartsContainer.clientWidth - 32;
    Object.entries(state.charts).forEach(([type, chart]) => {
      const height = state.expandedCharts.has(type) ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT_NORMAL;
      if (Math.abs(chart.width - width) > 4) {
        chart.setSize({ width, height });
      }
    });
  }, 100);

  const resizeObserver = new ResizeObserver(resizeCharts);
  resizeObserver.observe($('charts-container'));

  // Start
  init();

  // Public API
  return {
    destroy: () => {
      ac.abort();
      resizeObserver.disconnect();
      if (hideRaf != null) cancelAnimationFrame(hideRaf);
      Object.values(state.charts).forEach((c) => c.destroy());
      if (state.slider) state.slider.destroy();
    },
    selectSite: (siteId: string) => {
      const btn = root.querySelector(`.site-btn[data-id="${siteId}"]`) as HTMLElement | null;
      if (btn) btn.click();
      else loadSite(siteId);
    },
    clearSite: () => {
      Object.values(state.charts).forEach((c) => c.destroy());
      state.charts = {};
      state.chartData = {};
      state.data = null;
      state.site = null;
      state.dataMinTs = null;
      state.dataMaxTs = null;
      state.alarms = [];
      if (state.slider) { state.slider.destroy(); state.slider = null; }
      ($('slider-section')).style.display = 'none';
      ($('export-toolbar')).style.display = 'none';
      $('charts-container').innerHTML = '<div class="chart-placeholder">Select a site to view data</div>';
      $('parameter-toggles').innerHTML = '<span style="color: var(--muted); font-size: 0.875rem">Select a site to see parameters</span>';
      root.querySelectorAll('.site-btn').forEach((b) => b.classList.remove('active'));
    },
  };
}
