import uPlot from 'uplot';
import noUiSlider from 'nouislider';

type ApiFn = (url: string, noCache?: boolean) => Promise<any>;
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
      <span id="label-history" style="color: #94a3b8"></span>
      <span id="label-week" style="color: #3b82f6"></span>
      <span id="label-today" style="color: #10b981"></span>
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

export function createDashboard(root: HTMLElement, api: ApiFn, authFetch: AuthFetchFn): () => void {
  root.innerHTML = DASHBOARD_HTML;

  const ac = new AbortController();
  const { signal } = ac;

  // Scoped DOM query helper
  const $ = (id: string) => root.querySelector(`#${id}`) as HTMLElement;

  // State
  const state: any = {
    site: null,
    parameters: new Set(),
    parametersWithData: new Set(),
    parameterTypeOrder: [],
    expandedCharts: new Set(),
    start: null,
    end: null,
    charts: {} as Record<string, uPlot>,
    chartData: {} as Record<string, any>,
    slider: null as ReturnType<typeof noUiSlider.create> | null,
    data: null as any,
    alarms: [] as any[],
    showAlarms: true,
  };

  const CHART_HEIGHT_NORMAL = 180;
  const CHART_HEIGHT_EXPANDED = 400;

  const syncKey = uPlot.sync('parameters');

  // DOM elements (scoped to root)
  const tooltip = $('hover-tooltip');
  const tooltipTime = $('tooltip-time');
  const tooltipValues = $('tooltip-values');

  // Color palette
  const colors = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#be185d', '#ea580c'];
  const parameterColors: Record<string, string> = {};

  const alarmColors: Record<number, string> = {
    0: 'rgba(59, 130, 246, 0.15)',
    1: 'rgba(245, 158, 11, 0.25)',
    2: 'rgba(239, 68, 68, 0.35)',
  };
  const alarmBorderColors: Record<number, string> = {
    0: 'rgba(59, 130, 246, 0.5)',
    1: 'rgba(245, 158, 11, 0.7)',
    2: 'rgba(239, 68, 68, 0.8)',
  };

  function alarmBandsPlugin(paramType: string) {
    return {
      hooks: {
        draw: [(u: uPlot) => {
          if (!state.showAlarms || !state.alarms.length) return;
          const ctx = u.ctx;
          const { left, top, width, height } = u.bbox;
          const [xMin, xMax] = [u.scales.x.min!, u.scales.x.max!];

          state.alarms.forEach((alarm: any) => {
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

  function debounce(fn: (...args: any[]) => void, ms: number) {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  }

  async function downloadExport(siteId: string, format: 'csv' | 'ndjson', start: string, end: string) {
    const url = `/api/service/sites/${siteId}/readings?format=${format}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
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
    hubLink.href = `#/sites/${state.site.id}/show`;
    hubLink.textContent = `${state.site.name} — view site details`;
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

  // Initialize
  async function init() {
    const [projects, sites] = await Promise.all([
      api('/api/service/projects'),
      api('/api/service/sites'),
    ]);

    const container = $('site-groups');

    const sitesByProject: Record<string, any[]> = {};
    sites.forEach((s: any) => {
      const projectId = s.project_id || 'unknown';
      if (!sitesByProject[projectId]) sitesByProject[projectId] = [];
      sitesByProject[projectId].push(s);
    });

    let html = '';
    projects.forEach((project: any) => {
      const projectSites = sitesByProject[project.id] || [];
      if (projectSites.length === 0) return;
      html += `
        <div class="project-group">
          <div class="project-label">${project.name}</div>
          <div class="project-sites">
            ${projectSites.map((s: any) => `
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

    // Alarm toggle handler
    $('alarm-toggle').addEventListener('click', () => {
      state.showAlarms = !state.showAlarms;
      $('alarm-toggle').classList.toggle('active', state.showAlarms);
      Object.values(state.charts).forEach((c: any) => c.redraw());
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

    // Auto-load first site
    const firstBtn = container.querySelector('.site-btn') as HTMLElement | null;
    if (firstBtn) firstBtn.click();
  }

  async function loadSite(siteId: string) {
    const site = await api(`/api/service/sites/${siteId}`, true);
    state.site = site;
    updateExportToolbar();

    Object.values(state.charts).forEach((chart: any) => chart.destroy());
    state.charts = {};
    state.chartData = {};
    $('charts-container').innerHTML = '';

    const toggles = $('parameter-toggles');
    const types = [...new Set((site.parameters || []).map((s: any) => s.sensor_type).filter(Boolean))].sort() as string[];

    if (!types.length) {
      toggles.innerHTML = '<span style="color: var(--muted); font-size: 0.875rem;">No parameters configured</span>';
      state.parameters = new Set();
      $('charts-container').innerHTML = '<div class="chart-placeholder">No parameters configured</div>';
      return;
    }

    types.forEach((t, i) => parameterColors[t] = colors[i % colors.length]);
    state.parameters = new Set(types);
    state.parameterTypeOrder = types;

    toggles.innerHTML = types.map((t) => `
      <label class="parameter-toggle">
        <input type="checkbox" value="${t}" checked>
        <span style="color: ${parameterColors[t]}">${t}</span>
      </label>
    `).join('');

    toggles.querySelectorAll('input').forEach((cb) => {
      cb.addEventListener('change', () => {
        const input = cb as HTMLInputElement;
        if (input.checked) state.parameters.add(input.value);
        else state.parameters.delete(input.value);
        updateCharts();
      }, { signal });
    });

    if (!site.data_start || !site.data_end) {
      ($('slider-section')).style.display = 'none';
      $('charts-container').innerHTML = '<div class="chart-placeholder">No data available for this site</div>';
      return;
    }

    const minTs = new Date(site.data_start).getTime();
    const maxTs = new Date(site.data_end).getTime();

    $('min-date').textContent = formatDate(minTs);
    $('max-date').textContent = formatDate(maxTs);
    ($('slider-section')).style.display = 'block';

    const defaultWindow = Math.min(1 * 86400000, maxTs - minTs);
    state.start = new Date(maxTs - defaultWindow);
    state.end = new Date(maxTs);

    const sliderEl = $('time-slider');
    if (state.slider) {
      state.slider.destroy();
    }

    const rangeDays = (maxTs - minTs) / 86400000;
    const oneDayMs = 86400000;
    const oneWeekMs = 7 * oneDayMs;

    const todayStart = maxTs - oneDayMs;
    const weekStart = maxTs - oneWeekMs;

    let sliderRange: any;
    let pipsConfig: any;
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
        mode: 'positions' as const,
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
        mode: 'positions' as const,
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
        mode: 'count' as const,
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
      state.start = new Date(Number(values[0]));
      state.end = new Date(Number(values[1]));
      updateWindowInfo();
      fetchData();
    });

    sliderEl.addEventListener('dragstart', (e) => e.preventDefault(), { signal });
    sliderEl.addEventListener('selectstart', (e) => e.preventDefault(), { signal });

    updateWindowInfo();
    fetchData();
  }

  function updateWindowInfo() {
    const duration = state.end - state.start;
    $('window-info').textContent = `Showing: ${formatDuration(duration)}`;
  }

  const fetchData = debounce(async () => {
    if (!state.site || !state.start || !state.end) return;

    const days = (state.end - state.start) / 86400000;
    let endpoint: string, resolution: string;

    if (days <= 14) {
      endpoint = 'readings';
      resolution = '10-min raw';
    } else if (days <= 120) {
      endpoint = 'aggregates/hourly';
      resolution = 'hourly avg';
    } else if (days <= 1095) {
      endpoint = 'aggregates/daily';
      resolution = 'daily avg';
    } else {
      endpoint = 'aggregates/weekly';
      resolution = 'weekly avg';
    }

    const url = `/api/service/sites/${state.site.id}/${endpoint}?start=${state.start.toISOString()}&end=${state.end.toISOString()}&alarms=true`;

    showLoading();

    try {
      let data = await api(url);

      if (!data.times?.length && endpoint !== 'readings') {
        const fallbackUrl = `/api/service/sites/${state.site.id}/readings?start=${state.start.toISOString()}&end=${state.end.toISOString()}&alarms=true`;
        data = await api(fallbackUrl);
        resolution = '10-min raw (fallback)';
      }

      state.data = data;
      $('resolution-info').textContent = `(${resolution})`;
      state.alarms = extractAlarmsFromData(data);
      updateAlarmCount();
      updateCharts();
    } catch (e) {
      console.error('Failed to fetch data:', e);
      $('charts-container').innerHTML = '<div class="chart-placeholder">Error loading data</div>';
    } finally {
      hideLoading();
    }
  }, 100);

  function extractAlarmsFromData(data: any) {
    if (!data?.times?.length || !data?.parameters?.length) return [];
    const alarms: any[] = [];

    data.parameters.forEach((param: any) => {
      const sevs = param.severities || param.max_severity;
      if (!sevs) return;
      let currentAlarm: any = null;

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
              parameter_name: param.name,
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

  function hasData(param: any) {
    const values = param.values || param.avg || [];
    return values.some((v: any) => v != null);
  }

  function updateTooltip(idx: number | null, mouseX: number, mouseY: number) {
    if (idx == null || !state.data?.times?.length) {
      tooltip.classList.remove('visible');
      return;
    }

    const time = new Date(state.data.times[idx]);
    tooltipTime.textContent = time.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    let html = '';
    state.parameterTypeOrder.forEach((type: string) => {
      if (!state.parameters.has(type) || !state.chartData[type]) return;
      const { params } = state.chartData[type];
      params.forEach((param: any) => {
        const values = param.values || param.avg || [];
        const val = values[idx];
        const color = parameterColors[type] || '#666';
        const sevs = param.severities || param.max_severity;
        const sev = (sevs && state.showAlarms) ? (sevs[idx] || 0) : 0;
        const badge = sev > 0 ? `<span class="alarm-badge ${sev === 2 ? 'critical' : 'warning'}">${sev === 2 ? 'ALARM' : 'WARN'}</span>` : '';
        html += `<div class="tooltip-row">
          <span class="tooltip-label" style="color: ${color}">${param.name} ${badge}</span>
          <span class="tooltip-value">${val != null ? val.toFixed(2) : '--'} ${param.units || ''}</span>
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
      Object.values(state.charts).forEach((chart: any) => chart.destroy());
      state.charts = {};
      state.chartData = {};
      return;
    }

    const { times, parameters } = state.data;
    const timestamps = times.map((t: string) => new Date(t).getTime() / 1000);

    const paramsByType: Record<string, any[]> = {};
    state.parametersWithData.clear();

    parameters.forEach((param: any) => {
      if (!hasData(param)) return;
      if (!paramsByType[param.type]) paramsByType[param.type] = [];
      paramsByType[param.type].push(param);
      state.parametersWithData.add(param.type);
    });

    // Update parameter toggles
    const toggles = $('parameter-toggles');
    const allTypes = [...new Set(parameters.map((s: any) => s.type))].sort() as string[];
    toggles.innerHTML = allTypes.map((t) => {
      const hasAnyData = state.parametersWithData.has(t);
      const checked = state.parameters.has(t) && hasAnyData;
      return `<label class="parameter-toggle" ${!hasAnyData ? 'style="opacity: 0.4"' : ''}>
        <input type="checkbox" value="${t}" ${checked ? 'checked' : ''} ${!hasAnyData ? 'disabled' : ''}>
        <span style="color: ${parameterColors[t]}">${t}${!hasAnyData ? ' (no data)' : ''}</span>
      </label>`;
    }).join('');

    toggles.querySelectorAll('input:not(:disabled)').forEach((cb) => {
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
      Object.values(state.charts).forEach((chart: any) => chart.destroy());
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
        const el = root.querySelector(`#chart-${type}`);
        if (el) el.remove();
      }
    });

    const chartWidth = chartsContainer.clientWidth - 32;

    enabledTypes.forEach((type: string) => {
      const typeParams = paramsByType[type] || [];
      if (!typeParams.length) return;

      state.chartData[type] = { params: typeParams, timestamps };

      let chartDiv = root.querySelector(`#chart-${type}`) as HTMLElement | null;
      const isExpanded = state.expandedCharts.has(type);
      const chartHeight = isExpanded ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT_NORMAL;

      if (!chartDiv) {
        chartDiv = document.createElement('div');
        chartDiv.id = `chart-${type}`;
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
          const nextChart = root.querySelector(`#chart-${enabledTypes[i]}`) as HTMLElement | null;
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
          if (!state.site?.data_start || !state.site?.data_end) return;
          const siteMinTs = new Date(state.site.data_start).getTime();
          const siteMaxTs = new Date(state.site.data_end).getTime();
          state.slider.set([siteMinTs, siteMaxTs]);
        }, { signal });
      }

      const chartArea = chartDiv.querySelector('.chart-area')!;
      const expandBtn = chartDiv.querySelector('.chart-expand')!;
      expandBtn.textContent = isExpanded ? '\u2921' : '\u2922';
      (expandBtn as HTMLElement).title = isExpanded ? 'Collapse chart' : 'Expand chart';

      const seriesData: uPlot.AlignedData = [timestamps];
      const seriesOpts: uPlot.Series[] = [{}];

      typeParams.forEach((param: any) => {
        const values = param.values || param.avg || [];
        (seriesData as any[]).push(values);
        seriesOpts.push({
          label: param.name,
          stroke: parameterColors[type] || '#666',
          width: 1.5,
          value: (_u: uPlot, v: number | null) => v == null ? '--' : v.toFixed(2) + (param.units ? ' ' + param.units : ''),
        });
      });

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
            { stroke: '#64748b', grid: { stroke: '#e2e8f0' }, size: 50 },
            {
              stroke: parameterColors[type],
              grid: { stroke: '#e2e8f0' },
              size: 50,
              values: (_u: uPlot, vals: number[]) => vals.map((v) => v == null ? '' : v.toFixed(1)),
            },
          ],
          series: seriesOpts,
          cursor: {
            sync: { key: syncKey.key, setSeries: true },
            drag: { x: true, y: false },
          },
          plugins: [alarmBandsPlugin(type)],
          hooks: {
            setCursor: [
              (u: uPlot) => {
                const idx = u.cursor.idx;
                if (idx != null) {
                  const bbox = u.root.getBoundingClientRect();
                  const cx = u.cursor.left! + bbox.left;
                  const cy = u.cursor.top! + bbox.top;
                  updateTooltip(idx, cx, cy);
                } else {
                  hideTooltip();
                }
              },
            ],
            setSelect: [
              (u: uPlot) => {
                if (u.select.width > 0) {
                  const left = u.posToVal(u.select.left, 'x');
                  const right = u.posToVal(u.select.left + u.select.width, 'x');
                  state.slider.set([left * 1000, right * 1000]);
                  u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
                }
              },
            ],
          },
          legend: { show: false },
        };

        state.charts[type] = new uPlot(opts, seriesData, chartArea as HTMLElement);
      }
    });

    // Remove placeholder if we have charts
    const placeholder = chartsContainer.querySelector('.chart-placeholder');
    if (placeholder && enabledTypes.length) placeholder.remove();
  }

  // Event listeners
  $('charts-container').addEventListener('mouseleave', () => {
    hideTooltip();
  }, { signal });

  window.addEventListener('resize', debounce(() => {
    const chartsContainer = $('charts-container');
    const width = chartsContainer.clientWidth - 32;
    Object.entries(state.charts).forEach(([type, chart]: [string, any]) => {
      const height = state.expandedCharts.has(type) ? CHART_HEIGHT_EXPANDED : CHART_HEIGHT_NORMAL;
      chart.setSize({ width, height });
    });
  }, 100), { signal });

  // Start
  init();

  // Cleanup
  return () => {
    ac.abort();
    Object.values(state.charts).forEach((c: any) => c.destroy());
    if (state.slider) state.slider.destroy();
  };
}
