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
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface ParsedRow {
  time: number; // seconds from start
  concentration: number;
}

interface DischargeResult {
  discharge_m3s: number;
  discharge_ls: number;
  peak_concentration: number;
  peak_time: number;
  integral: number;
  recovery_rate: number | null;
  n_points: number;
  duration_s: number;
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Detect header
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

function computeDischarge(
  rows: ParsedRow[],
  injectedVolumeMl: number,
  injectedConcGl: number,
  backgroundConc: number,
): DischargeResult | null {
  if (rows.length < 2) return null;

  // Subtract background
  const corrected = rows.map((r) => ({
    time: r.time,
    concentration: Math.max(0, r.concentration - backgroundConc),
  }));

  const integral = trapezoidalIntegral(corrected);
  if (integral <= 0) return null;

  // Q = (V_inj * C_inj) / integral(C(t) dt)
  // Convert: volume mL -> L, concentration g/L stays as-is
  // integral is in (g/L)*s if concentration column is g/L, or (mg/L)*s if mg/L
  // We need consistent units. Assume concentration is in mg/L (common for conductivity-derived).
  // Mass injected = V_inj (mL) * C_inj (g/L) = V_inj/1000 * C_inj * 1000 mg = V_inj * C_inj mg
  // integral is in (mg/L)*s
  // Q = mass / integral = (V_inj * C_inj) mg / ((mg/L)*s) = V_inj * C_inj L/s
  // But V_inj is in mL, so Q = (V_inj / 1000) * C_inj / integral  [L/s] ... no.
  //
  // Cleaner: mass_injected (mg) = V_inj_mL * C_inj_g_per_L * 1000 (mg/g)
  // integral unit: (mg/L) * s
  // Q = mass_injected / integral = (V_inj_mL * C_inj_g_per_L * 1000) / integral_mg_per_L_s
  //   = result in L/s

  const massInjectedMg = injectedVolumeMl * injectedConcGl * 1000;
  const dischargeLs = massInjectedMg / integral;
  const dischargeM3s = dischargeLs / 1000;

  const peak = corrected.reduce((max, r) => (r.concentration > max.concentration ? r : max), corrected[0]);

  // Recovery rate: ratio of mass recovered to mass injected
  // Mass recovered = Q * integral (in same units)
  // This is always 1.0 by definition for this method — recovery rate is only meaningful
  // if you compare measured integral to theoretical. We'll report null unless we have
  // a way to compute it differently.

  return {
    discharge_m3s: dischargeM3s,
    discharge_ls: dischargeLs,
    peak_concentration: peak.concentration + backgroundConc,
    peak_time: peak.time,
    integral,
    recovery_rate: null,
    n_points: rows.length,
    duration_s: rows[rows.length - 1].time - rows[0].time,
  };
}

export const DischargeTool = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [siteId, setSiteId] = useState('');
  const [injectedVolume, setInjectedVolume] = useState('1000');
  const [injectedConc, setInjectedConc] = useState('200');
  const [backgroundConc, setBackgroundConc] = useState('0');
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

  // Render chart when csvData changes
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
          label: 'Concentration',
          stroke: '#2196f3',
          width: 2,
          fill: 'rgba(33, 150, 243, 0.1)',
          points: { show: true, size: 4 },
        },
      ],
      axes: [
        { label: 'Time (s)' },
        { label: 'Concentration', size: 70 },
      ],
      scales: {
        x: { time: false },
      },
      cursor: {
        drag: { x: true, y: false },
      },
    };

    uplotRef.current?.destroy();
    uplotRef.current = new uPlot(opts, [times, concs], chartRef.current);

    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [csvData]);

  // Handle resize
  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver(() => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 300,
        });
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

    if (isNaN(vol) || vol <= 0) {
      setError('Injected volume must be a positive number.');
      return;
    }
    if (isNaN(conc) || conc <= 0) {
      setError('Injected concentration must be a positive number.');
      return;
    }
    if (isNaN(bg) || bg < 0) {
      setError('Background concentration must be non-negative.');
      return;
    }
    if (csvData.length < 2) {
      setError('Upload a CSV with breakthrough curve data first.');
      return;
    }

    const r = computeDischarge(csvData, vol, conc, bg);
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
      `Peak Concentration,${result.peak_concentration.toFixed(2)},mg/L`,
      `Peak Time,${result.peak_time.toFixed(1)},s`,
      `Integral,${result.integral.toFixed(2)},(mg/L)*s`,
      `Duration,${result.duration_s.toFixed(1)},s`,
      `Data Points,${result.n_points},`,
      `Injected Volume,${injectedVolume},mL`,
      `Injected Concentration,${injectedConc},g/L`,
      `Background Concentration,${backgroundConc},mg/L`,
      `Site,${site?.name ?? siteId},`,
      `Source File,${fileName},`,
    ];
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
      {/* Input form */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            Injection Parameters
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              select
              label="Site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              size="small"
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">
                <em>Optional</em>
              </MenuItem>
              {(sites ?? []).map((site) => (
                <MenuItem key={site.id} value={site.id}>
                  {site.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Injected Volume (mL)"
              type="number"
              value={injectedVolume}
              onChange={(e) => setInjectedVolume(e.target.value)}
              size="small"
              sx={{ width: 180 }}
            />
            <TextField
              label="Injected Conc. (g/L)"
              type="number"
              value={injectedConc}
              onChange={(e) => setInjectedConc(e.target.value)}
              size="small"
              sx={{ width: 180 }}
            />
            <TextField
              label="Background (mg/L)"
              type="number"
              value={backgroundConc}
              onChange={(e) => setBackgroundConc(e.target.value)}
              size="small"
              sx={{ width: 180 }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* CSV Upload */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>
            Breakthrough Curve Data
          </Typography>
          <Paper
            variant="outlined"
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              p: 4,
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: dragOver ? 'action.hover' : 'background.default',
              borderStyle: 'dashed',
              borderColor: dragOver ? 'primary.main' : 'divider',
              transition: 'all 0.2s',
            }}
          >
            <UploadFileIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
            <Typography color="text.secondary">
              {fileName
                ? `Loaded: ${fileName} (${csvData.length} points)`
                : 'Drop a CSV file here or click to browse'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Expected columns: time (seconds), concentration (mg/L)
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />
          </Paper>
        </CardContent>
      </Card>

      {/* Chart */}
      {csvData.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              Breakthrough Curve
            </Typography>
            <div ref={chartRef} style={{ width: '100%' }} />
          </CardContent>
        </Card>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {/* Calculate button */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button variant="contained" onClick={calculate} disabled={csvData.length < 2}>
          Calculate Discharge
        </Button>
        {result && (
          <Button variant="outlined" onClick={exportCsv}>
            Export Results CSV
          </Button>
        )}
      </Box>

      {/* Results */}
      {result && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              Results
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Discharge</TableCell>
                  <TableCell>{result.discharge_ls.toFixed(4)} L/s</TableCell>
                  <TableCell>({result.discharge_m3s.toExponential(4)} m3/s)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Peak Concentration</TableCell>
                  <TableCell>{result.peak_concentration.toFixed(2)} mg/L</TableCell>
                  <TableCell>at t = {result.peak_time.toFixed(1)} s</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Integral</TableCell>
                  <TableCell>{result.integral.toFixed(2)} (mg/L)*s</TableCell>
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
