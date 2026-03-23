import { useState, useRef, useEffect, useCallback } from 'react';
import { useGetList } from 'react-admin';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  MenuItem,
  Button,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  FormControlLabel,
  Switch,
  Divider,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedRow {
  time: number;
  concentration: number;
}

interface DischargeResult {
  discharge_m3s: number;
  discharge_ls: number;
  peak_concentration: number;
  peak_time: number;
  integral: number;
  velocity_ms: number | null;
  n_points: number;
  duration_s: number;
}

type TracerType = 'salt' | 'rhodamine';
type BackgroundMode = 'constant' | 'regression';

// ---------------------------------------------------------------------------
// Calculation helpers
// ---------------------------------------------------------------------------

function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('time') || header.includes('conc') || isNaN(Number(lines[0].split(/[,;\t]/)[0]));
  const startIdx = hasHeader ? 1 : 0;

  const rows: ParsedRow[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(/[,;\t]/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const time = Number(parts[0]);
    const concentration = Number(parts[1]);
    if (isNaN(time) || isNaN(concentration)) continue;
    rows.push({ time, concentration });
  }

  return rows.sort((a, b) => a.time - b.time);
}

function trapezoidalIntegral(rows: ParsedRow[]): number {
  if (rows.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i].time - rows[i - 1].time;
    sum += 0.5 * (rows[i - 1].concentration + rows[i].concentration) * dt;
  }
  return sum;
}

/** Simple linear regression: y = slope * x + intercept */
function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-15) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/** Simple 5-point moving average smoother */
function smooth(data: ParsedRow[], windowSize: number): ParsedRow[] {
  if (windowSize < 3 || data.length < windowSize) return data;
  const half = Math.floor(windowSize / 2);
  return data.map((row, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(data.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += data[j].concentration;
    return { time: row.time, concentration: sum / (hi - lo + 1) };
  });
}

/** Rhodamine temperature correction: C_corrected = C * exp(k * (T_water - T_ref)) */
function rhodamineTemperatureCorrection(
  rows: ParsedRow[],
  waterTempC: number,
  refTempC: number,
  correctionFactor: number,
): ParsedRow[] {
  const factor = Math.exp(correctionFactor * (waterTempC - refTempC));
  return rows.map((r) => ({ time: r.time, concentration: r.concentration * factor }));
}

function subtractBackground(
  rows: ParsedRow[],
  mode: BackgroundMode,
  constantBg: number,
  prePoints: number,
  postPoints: number,
): ParsedRow[] {
  if (mode === 'constant') {
    return rows.map((r) => ({
      time: r.time,
      concentration: Math.max(0, r.concentration - constantBg),
    }));
  }

  // Regression mode: fit line through first N and last M points
  const pre = rows.slice(0, Math.min(prePoints, rows.length));
  const post = rows.slice(Math.max(0, rows.length - postPoints));
  const bgPoints = [...pre, ...post];
  const { slope, intercept } = linearRegression(
    bgPoints.map((r) => r.time),
    bgPoints.map((r) => r.concentration),
  );

  return rows.map((r) => ({
    time: r.time,
    concentration: Math.max(0, r.concentration - (slope * r.time + intercept)),
  }));
}

function computeDischarge(
  rows: ParsedRow[],
  tracer: TracerType,
  injectedVolumeMl: number,
  injectedConcGl: number,
  bgMode: BackgroundMode,
  constantBg: number,
  prePoints: number,
  postPoints: number,
  waterTempC: number,
  refTempC: number,
  tempCorrFactor: number,
  applySmoothing: boolean,
  smoothWindow: number,
  distanceM: number,
): DischargeResult | null {
  if (rows.length < 2) return null;

  let processed = [...rows];

  // Rhodamine temperature correction (before background subtraction)
  if (tracer === 'rhodamine') {
    processed = rhodamineTemperatureCorrection(processed, waterTempC, refTempC, tempCorrFactor);
  }

  // Background correction
  processed = subtractBackground(processed, bgMode, constantBg, prePoints, postPoints);

  // Smoothing
  if (applySmoothing) {
    processed = smooth(processed, smoothWindow);
    // Clamp negatives after smoothing
    processed = processed.map((r) => ({ time: r.time, concentration: Math.max(0, r.concentration) }));
  }

  const integral = trapezoidalIntegral(processed);
  if (integral <= 0) return null;

  // Q = mass_injected / integral
  // mass_injected (mg) = V_inj_mL * C_inj_g_per_L * 1000
  // integral is in (mg/L)*s
  // Q in L/s
  const massInjectedMg = injectedVolumeMl * injectedConcGl * 1000;
  const dischargeLs = massInjectedMg / integral;
  const dischargeM3s = dischargeLs / 1000;

  const peak = processed.reduce((max, r) => (r.concentration > max.concentration ? r : max), processed[0]);

  const velocityMs = distanceM > 0 && peak.time > 0 ? distanceM / peak.time : null;

  return {
    discharge_m3s: dischargeM3s,
    discharge_ls: dischargeLs,
    peak_concentration: peak.concentration,
    peak_time: peak.time,
    integral,
    velocity_ms: velocityMs,
    n_points: rows.length,
    duration_s: rows[rows.length - 1].time - rows[0].time,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DischargeTool = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [siteId, setSiteId] = useState('');
  const [tracer, setTracer] = useState<TracerType>('salt');
  const [injectedVolume, setInjectedVolume] = useState('1000');
  const [injectedConc, setInjectedConc] = useState('200');
  const [distance, setDistance] = useState('');

  // Background
  const [bgMode, setBgMode] = useState<BackgroundMode>('constant');
  const [backgroundConc, setBackgroundConc] = useState('0');
  const [prePoints, setPrePoints] = useState('15');
  const [postPoints, setPostPoints] = useState('10');

  // Rhodamine
  const [waterTemp, setWaterTemp] = useState('');
  const [refTemp, setRefTemp] = useState('20');
  const [tempCorrFactor, setTempCorrFactor] = useState('0.029');

  // Smoothing
  const [applySmoothing, setApplySmoothing] = useState(false);
  const [smoothWindow, setSmoothWindow] = useState('5');

  const [csvData, setCsvData] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<DischargeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: sites } = useGetList('sites', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });

  const handleFile = useCallback((file: File) => {
    setError(null);
    setResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setError('CSV must have at least 2 data rows with time and concentration columns.');
        setCsvData([]);
        return;
      }
      setCsvData(rows);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // Render chart
  useEffect(() => {
    if (csvData.length < 2 || !chartRef.current) {
      uplotRef.current?.destroy();
      uplotRef.current = null;
      return;
    }

    const times = csvData.map((r) => r.time);
    const concs = csvData.map((r) => r.concentration);

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 300,
      series: [
        { label: 'Time (s)' },
        {
          label: tracer === 'rhodamine' ? 'Concentration (ppb)' : 'Concentration (mg/L)',
          stroke: tracer === 'rhodamine' ? '#e91e63' : '#2196f3',
          width: 2,
          fill: tracer === 'rhodamine' ? 'rgba(233, 30, 99, 0.1)' : 'rgba(33, 150, 243, 0.1)',
          points: { show: true, size: 4 },
        },
      ],
      axes: [
        { label: 'Time (s)' },
        { label: tracer === 'rhodamine' ? 'ppb' : 'mg/L', size: 70 },
      ],
      scales: { x: { time: false } },
      cursor: { drag: { x: true, y: false } },
    };

    uplotRef.current?.destroy();
    uplotRef.current = new uPlot(opts, [times, concs], chartRef.current);

    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [csvData, tracer]);

  // Resize handler
  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({ width: chartRef.current.clientWidth, height: 300 });
      }
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  const calculate = () => {
    setError(null);
    const vol = Number(injectedVolume);
    const conc = Number(injectedConc);
    const bg = Number(backgroundConc);

    if (isNaN(vol) || vol <= 0) { setError('Injected volume must be a positive number.'); return; }
    if (isNaN(conc) || conc <= 0) { setError('Injected concentration must be a positive number.'); return; }
    if (bgMode === 'constant' && (isNaN(bg) || bg < 0)) { setError('Background concentration must be non-negative.'); return; }
    if (csvData.length < 2) { setError('Upload a CSV with breakthrough curve data first.'); return; }
    if (tracer === 'rhodamine' && (!waterTemp || isNaN(Number(waterTemp)))) { setError('Water temperature is required for rhodamine tracer.'); return; }

    const r = computeDischarge(
      csvData,
      tracer,
      vol,
      conc,
      bgMode,
      bg,
      Number(prePoints) || 15,
      Number(postPoints) || 10,
      Number(waterTemp) || 0,
      Number(refTemp) || 20,
      Number(tempCorrFactor) || 0.029,
      applySmoothing,
      Number(smoothWindow) || 5,
      Number(distance) || 0,
    );
    if (!r) {
      setError('Could not compute discharge. Check that the integral is positive (concentration above background).');
      return;
    }
    setResult(r);
  };

  const exportCsv = () => {
    if (!result) return;
    const site = sites?.find((s) => s.id === siteId);
    const lines = [
      'Parameter,Value,Units',
      `Discharge,${result.discharge_m3s.toExponential(4)},m3/s`,
      `Discharge,${result.discharge_ls.toFixed(4)},L/s`,
      `Peak Concentration,${result.peak_concentration.toFixed(2)},${tracer === 'rhodamine' ? 'ppb' : 'mg/L'}`,
      `Peak Time,${result.peak_time.toFixed(1)},s`,
      `Integral,${result.integral.toFixed(2)},(${tracer === 'rhodamine' ? 'ppb' : 'mg/L'})*s`,
      result.velocity_ms != null ? `Velocity,${result.velocity_ms.toFixed(4)},m/s` : '',
      `Duration,${result.duration_s.toFixed(1)},s`,
      `Data Points,${result.n_points},`,
      `Tracer,${tracer},`,
      `Injected Volume,${injectedVolume},mL`,
      `Injected Concentration,${injectedConc},g/L`,
      `Background Mode,${bgMode},`,
      bgMode === 'constant' ? `Background Concentration,${backgroundConc},mg/L` : `Regression Points,${prePoints} pre / ${postPoints} post,`,
      applySmoothing ? `Smoothing Window,${smoothWindow},points` : 'Smoothing,off,',
      tracer === 'rhodamine' ? `Water Temperature,${waterTemp},°C` : '',
      `Site,${site?.name ?? siteId},`,
      `Source File,${fileName},`,
    ].filter(Boolean);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `discharge_result_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Injection parameters */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Injection Parameters</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              select label="Tracer Type" value={tracer}
              onChange={(e) => setTracer(e.target.value as TracerType)}
              size="small" sx={{ minWidth: 160 }}
            >
              <MenuItem value="salt">Salt (Conductivity)</MenuItem>
              <MenuItem value="rhodamine">Rhodamine WT</MenuItem>
            </TextField>
            <TextField
              select label="Site" value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              size="small" sx={{ minWidth: 200 }}
            >
              <MenuItem value=""><em>Optional</em></MenuItem>
              {(sites ?? []).map((site) => (
                <MenuItem key={site.id} value={site.id}>{site.name}</MenuItem>
              ))}
            </TextField>
            <TextField label="Injected Volume (mL)" type="number" value={injectedVolume} onChange={(e) => setInjectedVolume(e.target.value)} size="small" sx={{ width: 180 }} />
            <TextField label="Injected Conc. (g/L)" type="number" value={injectedConc} onChange={(e) => setInjectedConc(e.target.value)} size="small" sx={{ width: 180 }} />
            <TextField label="Distance (m)" type="number" value={distance} onChange={(e) => setDistance(e.target.value)} size="small" sx={{ width: 140 }} helperText="For velocity calc" />
          </Box>
        </CardContent>
      </Card>

      {/* Background correction */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Background Correction</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <TextField
              select label="Method" value={bgMode}
              onChange={(e) => setBgMode(e.target.value as BackgroundMode)}
              size="small" sx={{ minWidth: 200 }}
            >
              <MenuItem value="constant">Constant Value</MenuItem>
              <MenuItem value="regression">Linear Regression</MenuItem>
            </TextField>
            {bgMode === 'constant' && (
              <TextField label="Background (mg/L)" type="number" value={backgroundConc} onChange={(e) => setBackgroundConc(e.target.value)} size="small" sx={{ width: 180 }} />
            )}
            {bgMode === 'regression' && (
              <>
                <TextField label="Pre-injection pts" type="number" value={prePoints} onChange={(e) => setPrePoints(e.target.value)} size="small" sx={{ width: 160 }} helperText="First N points" />
                <TextField label="Post-injection pts" type="number" value={postPoints} onChange={(e) => setPostPoints(e.target.value)} size="small" sx={{ width: 160 }} helperText="Last N points" />
              </>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Rhodamine temperature correction */}
      {tracer === 'rhodamine' && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>Temperature Correction (Rhodamine)</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField label="Water Temp (°C)" type="number" value={waterTemp} onChange={(e) => setWaterTemp(e.target.value)} size="small" required />
              <TextField label="Ref Temp (°C)" type="number" value={refTemp} onChange={(e) => setRefTemp(e.target.value)} size="small" />
              <TextField label="Correction Factor" type="number" value={tempCorrFactor} onChange={(e) => setTempCorrFactor(e.target.value)} size="small" helperText="Default 0.029/°C" />
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Smoothing */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControlLabel
              control={<Switch checked={applySmoothing} onChange={(e) => setApplySmoothing(e.target.checked)} />}
              label="Apply Smoothing"
            />
            {applySmoothing && (
              <TextField
                label="Window size" type="number" value={smoothWindow}
                onChange={(e) => setSmoothWindow(e.target.value)} size="small" sx={{ width: 120 }}
                helperText="Odd number"
              />
            )}
          </Box>
        </CardContent>
      </Card>

      {/* CSV Upload */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Breakthrough Curve Data</Typography>
          <Paper
            variant="outlined"
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              p: 4, textAlign: 'center', cursor: 'pointer',
              backgroundColor: dragOver ? 'action.hover' : 'background.default',
              borderStyle: 'dashed', borderColor: dragOver ? 'primary.main' : 'divider',
              transition: 'all 0.2s',
            }}
          >
            <UploadFileIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">
              {fileName ? `Loaded: ${fileName} (${csvData.length} points)` : 'Drop a CSV file here or click to browse'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Expected columns: time (seconds), concentration ({tracer === 'rhodamine' ? 'ppb' : 'mg/L'})
            </Typography>
            <input ref={fileInputRef} type="file" accept=".csv,.txt,.tsv" onChange={handleFileInput} style={{ display: 'none' }} />
          </Paper>
        </CardContent>
      </Card>

      {/* Chart */}
      {csvData.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>Breakthrough Curve</Typography>
            <div ref={chartRef} style={{ width: '100%' }} />
          </CardContent>
        </Card>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {/* Calculate */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button variant="contained" onClick={calculate} disabled={csvData.length < 2}>Calculate Discharge</Button>
        {result && <Button variant="outlined" onClick={exportCsv}>Export Results CSV</Button>}
      </Box>

      {/* Results */}
      {result && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>Results</Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Discharge</TableCell>
                  <TableCell>{result.discharge_ls.toFixed(4)} L/s</TableCell>
                  <TableCell>({result.discharge_m3s.toExponential(4)} m&#179;/s)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Peak Concentration</TableCell>
                  <TableCell>{result.peak_concentration.toFixed(2)} {tracer === 'rhodamine' ? 'ppb' : 'mg/L'}</TableCell>
                  <TableCell>at t = {result.peak_time.toFixed(1)} s</TableCell>
                </TableRow>
                {result.velocity_ms != null && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Velocity</TableCell>
                    <TableCell>{result.velocity_ms.toFixed(4)} m/s</TableCell>
                    <TableCell>over {distance} m</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Integral</TableCell>
                  <TableCell>{result.integral.toFixed(2)} ({tracer === 'rhodamine' ? 'ppb' : 'mg/L'})*s</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Duration</TableCell>
                  <TableCell>{result.duration_s.toFixed(1)} s</TableCell>
                  <TableCell>{result.n_points} data points</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};
