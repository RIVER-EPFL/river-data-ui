import { useState, useMemo, useCallback } from 'react';
import { TextField, Box, FormControlLabel, Switch, Button, Typography, Collapse, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { ToolLayout } from './ToolLayout';
import { LoadStandardCurveButton } from './LoadStandardCurveButton';

export const FieldDataTool = () => {
  const [elevationM, setElevationM] = useState('');
  const [tempC, setTempC] = useState('');
  const [pressureHpa, setPressureHpa] = useState('');
  const [useCurve, setUseCurve] = useState(false);
  const [slope, setSlope] = useState('');
  const [intercept, setIntercept] = useState('');

  // CO2 mode: single vs multi
  const [multiCo2, setMultiCo2] = useState(false);
  const [rawCo2, setRawCo2] = useState('');
  const [rawCo2Min, setRawCo2Min] = useState('');
  const [rawCo2Avg, setRawCo2Avg] = useState('');
  const [rawCo2Max, setRawCo2Max] = useState('');

  // Reach depth
  const [showReachDepth, setShowReachDepth] = useState(false);
  const [reachDepths, setReachDepths] = useState<string[]>(['', '', '']);

  const handleLoadCurve = useCallback((s: number, i: number) => {
    setSlope(String(s));
    setIntercept(String(i));
    setUseCurve(true);
  }, []);

  const handleDepthChange = useCallback((index: number, value: string) => {
    setReachDepths(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const addDepth = useCallback(() => setReachDepths(prev => [...prev, '']), []);
  const removeDepth = useCallback((index: number) => {
    setReachDepths(prev => prev.filter((_, i) => i !== index));
  }, []);

  const inputs = useMemo(() => {
    const result: Record<string, unknown> = {
      elevation_m: elevationM ? Number(elevationM) : null,
      temp_c: tempC ? Number(tempC) : null,
      pressure_hpa: pressureHpa ? Number(pressureHpa) : null,
    };
    if (multiCo2) {
      result.raw_co2_min = rawCo2Min ? Number(rawCo2Min) : null;
      result.raw_co2_avg = rawCo2Avg ? Number(rawCo2Avg) : null;
      result.raw_co2_max = rawCo2Max ? Number(rawCo2Max) : null;
    } else {
      result.raw_co2 = rawCo2 ? Number(rawCo2) : null;
    }
    if (useCurve && slope && intercept) {
      result.std_curve = { slope: Number(slope), intercept: Number(intercept) };
    }
    if (showReachDepth) {
      const depths = reachDepths.filter(d => d !== '').map(Number).filter(n => !isNaN(n));
      if (depths.length > 0) {
        result.reach_depths = depths;
      }
    }
    return result;
  }, [elevationM, tempC, pressureHpa, multiCo2, rawCo2, rawCo2Min, rawCo2Avg, rawCo2Max, useCurve, slope, intercept, showReachDepth, reachDepths]);

  return (
    <ToolLayout toolName="field_data" description="Field data corrections: barometric pressure from altitude and CO2 correction with optional standard curve." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Elevation (m)" value={elevationM} onChange={(e) => setElevationM(e.target.value)} type="number" />
        <TextField label="Temperature (°C)" value={tempC} onChange={(e) => setTempC(e.target.value)} type="number" />
        <TextField label="Pressure (hPa)" value={pressureHpa} onChange={(e) => setPressureHpa(e.target.value)} type="number" />
      </Box>

      <FormControlLabel
        control={<Switch checked={multiCo2} onChange={(e) => setMultiCo2(e.target.checked)} />}
        label="Vaisala Min/Avg/Max"
        sx={{ mt: 1 }}
      />
      {multiCo2 ? (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField label="Raw CO2 Min (ppm)" value={rawCo2Min} onChange={(e) => setRawCo2Min(e.target.value)} type="number" />
          <TextField label="Raw CO2 Avg (ppm)" value={rawCo2Avg} onChange={(e) => setRawCo2Avg(e.target.value)} type="number" />
          <TextField label="Raw CO2 Max (ppm)" value={rawCo2Max} onChange={(e) => setRawCo2Max(e.target.value)} type="number" />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField label="Raw CO2 (ppm)" value={rawCo2} onChange={(e) => setRawCo2(e.target.value)} type="number" />
        </Box>
      )}

      <FormControlLabel
        control={<Switch checked={useCurve} onChange={(e) => setUseCurve(e.target.checked)} />}
        label="Apply standard curve correction"
      />
      {useCurve && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField label="Slope" value={slope} onChange={(e) => setSlope(e.target.value)} type="number" />
          <TextField label="Intercept" value={intercept} onChange={(e) => setIntercept(e.target.value)} type="number" />
          <LoadStandardCurveButton onLoad={handleLoadCurve} />
        </Box>
      )}

      <Box sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => setShowReachDepth(!showReachDepth)}>
          {showReachDepth ? 'Hide Reach Depth' : 'Reach Depth'}
        </Button>
      </Box>
      <Collapse in={showReachDepth}>
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>Reach Depth Measurements (cm)</Typography>
        {reachDepths.map((depth, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
            <TextField
              label={`Depth ${i + 1}`}
              value={depth}
              onChange={(e) => handleDepthChange(i, e.target.value)}
              type="number"
              sx={{ width: 150 }}
            />
            {reachDepths.length > 1 && (
              <IconButton onClick={() => removeDepth(i)}><RemoveIcon fontSize="small" /></IconButton>
            )}
          </Box>
        ))}
        <Button startIcon={<AddIcon />} onClick={addDepth}>Add measurement</Button>
      </Collapse>
    </ToolLayout>
  );
};
