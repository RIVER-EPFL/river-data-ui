import { useState, useMemo, useCallback } from 'react';
import { TextField, Box, FormControlLabel, Switch } from '@mui/material';
import { ToolLayout } from './ToolLayout';
import { LoadStandardCurveButton } from './LoadStandardCurveButton';

export const FieldDataTool = () => {
  const [elevationM, setElevationM] = useState('');
  const [tempC, setTempC] = useState('');
  const [rawCo2, setRawCo2] = useState('');
  const [pressureHpa, setPressureHpa] = useState('');
  const [useCurve, setUseCurve] = useState(false);
  const [slope, setSlope] = useState('');
  const [intercept, setIntercept] = useState('');

  const handleLoadCurve = useCallback((s: number, i: number) => {
    setSlope(String(s));
    setIntercept(String(i));
    setUseCurve(true);
  }, []);

  const inputs = useMemo(() => {
    const result: Record<string, unknown> = {
      elevation_m: elevationM ? Number(elevationM) : null,
      temp_c: tempC ? Number(tempC) : null,
      raw_co2: rawCo2 ? Number(rawCo2) : null,
      pressure_hpa: pressureHpa ? Number(pressureHpa) : null,
    };
    if (useCurve && slope && intercept) {
      result.std_curve = { slope: Number(slope), intercept: Number(intercept) };
    }
    return result;
  }, [elevationM, tempC, rawCo2, pressureHpa, useCurve, slope, intercept]);

  return (
    <ToolLayout toolName="field_data" description="Field data corrections: barometric pressure from altitude and CO2 correction with optional standard curve." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Elevation (m)" value={elevationM} onChange={(e) => setElevationM(e.target.value)} type="number" size="small" />
        <TextField label="Temperature (°C)" value={tempC} onChange={(e) => setTempC(e.target.value)} type="number" size="small" />
        <TextField label="Raw CO2 (ppm)" value={rawCo2} onChange={(e) => setRawCo2(e.target.value)} type="number" size="small" />
        <TextField label="Pressure (hPa)" value={pressureHpa} onChange={(e) => setPressureHpa(e.target.value)} type="number" size="small" />
      </Box>
      <FormControlLabel
        control={<Switch checked={useCurve} onChange={(e) => setUseCurve(e.target.checked)} />}
        label="Apply standard curve correction"
      />
      {useCurve && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField label="Slope" value={slope} onChange={(e) => setSlope(e.target.value)} type="number" size="small" />
          <TextField label="Intercept" value={intercept} onChange={(e) => setIntercept(e.target.value)} type="number" size="small" />
          <LoadStandardCurveButton onLoad={handleLoadCurve} />
        </Box>
      )}
    </ToolLayout>
  );
};
