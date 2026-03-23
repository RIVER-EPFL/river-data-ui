import { useState, useMemo } from 'react';
import { TextField, Box, MenuItem, Button, Divider, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { ToolLayout } from './ToolLayout';

export const Pco2Tool = () => {
  const [mode, setMode] = useState<'simple' | 'full_pipeline'>('simple');

  // Simple mode
  const [co2aq, setCo2aq] = useState('');
  const [variant, setVariant] = useState('simple');

  // Shared
  const [waterTemp, setWaterTemp] = useState('');
  const [pressure, setPressure] = useState('');

  // Full pipeline mode
  const [co2ppm, setCo2ppm] = useState('');
  const [h2o, setH2o] = useState('');
  const [ch4, setCh4] = useState('');
  const [d13co2, setD13co2] = useState('');
  const [labTemp, setLabTemp] = useState('22');
  const [labPressure, setLabPressure] = useState('0.95');
  const [volSa, setVolSa] = useState('60');
  const [volWater, setVolWater] = useState('40');

  // Replicate B
  const [showRepB, setShowRepB] = useState(false);
  const [co2ppmB, setCo2ppmB] = useState('');
  const [h2oB, setH2oB] = useState('');
  const [ch4B, setCh4B] = useState('');
  const [d13co2B, setD13co2B] = useState('');

  const inputs = useMemo(() => {
    if (mode === 'simple') {
      return {
        mode: 'simple',
        co2_aq_umol: Number(co2aq) || 0,
        water_temp_c: Number(waterTemp) || 0,
        pressure_hpa: pressure ? Number(pressure) : null,
        variant,
      };
    }

    const payload: Record<string, unknown> = {
      mode: 'full_pipeline',
      co2_ppm: Number(co2ppm) || 0,
      h2o_percent: Number(h2o) || 0,
      ch4_ppm: Number(ch4) || 0,
      d13co2_permil: d13co2 ? Number(d13co2) : null,
      lab_temp_c: Number(labTemp) || 22,
      lab_pressure_atm: Number(labPressure) || 0.95,
      vol_sa_ml: Number(volSa) || 60,
      vol_water_ml: Number(volWater) || 40,
      water_temp_c: Number(waterTemp) || 0,
      pressure_hpa: Number(pressure) || 0,
    };

    if (showRepB) {
      payload.replicate_b = {
        co2_ppm: Number(co2ppmB) || 0,
        h2o_percent: Number(h2oB) || 0,
        ch4_ppm: Number(ch4B) || 0,
        d13co2_permil: d13co2B ? Number(d13co2B) : null,
      };
    }

    return payload;
  }, [mode, co2aq, waterTemp, pressure, variant, co2ppm, h2o, ch4, d13co2, labTemp, labPressure, volSa, volWater, showRepB, co2ppmB, h2oB, ch4B, d13co2B]);

  return (
    <ToolLayout
      toolName="pco2"
      description="pCO2 from headspace equilibration. Simple mode takes pre-computed CO2aq; Full Pipeline starts from raw Picarro data."
      inputs={inputs}
    >
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <TextField
          label="Mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'simple' | 'full_pipeline')}
          select
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="simple">Simple (from CO2aq)</MenuItem>
          <MenuItem value="full_pipeline">Full Pipeline (raw Picarro)</MenuItem>
        </TextField>
      </Box>

      {mode === 'simple' && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField label="CO2aq (uM)" value={co2aq} onChange={(e) => setCo2aq(e.target.value)} type="number" size="small" required />
          <TextField label="Water temp (C)" value={waterTemp} onChange={(e) => setWaterTemp(e.target.value)} type="number" size="small" required />
          <TextField
            label="Variant"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            select
            size="small"
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="simple">Simple</MenuItem>
            <MenuItem value="p1">P1 (bp correction)</MenuItem>
            <MenuItem value="p2">P2 (inverse bp)</MenuItem>
          </TextField>
          {variant !== 'simple' && (
            <TextField label="Pressure (hPa)" value={pressure} onChange={(e) => setPressure(e.target.value)} type="number" size="small" required />
          )}
        </Box>
      )}

      {mode === 'full_pipeline' && (
        <>
          <Typography variant="caption" color="text.secondary">Replicate A</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField label="CO2 (ppm)" value={co2ppm} onChange={(e) => setCo2ppm(e.target.value)} type="number" size="small" required />
            <TextField label="H2O (%)" value={h2o} onChange={(e) => setH2o(e.target.value)} type="number" size="small" required />
            <TextField label="CH4 (ppm)" value={ch4} onChange={(e) => setCh4(e.target.value)} type="number" size="small" required />
            <TextField label="d13C-CO2 (permil)" value={d13co2} onChange={(e) => setD13co2(e.target.value)} type="number" size="small" />
          </Box>

          {showRepB && (
            <>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Replicate B</Typography>
                <Button size="small" startIcon={<RemoveIcon />} onClick={() => setShowRepB(false)}>Remove</Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField label="CO2 (ppm)" value={co2ppmB} onChange={(e) => setCo2ppmB(e.target.value)} type="number" size="small" required />
                <TextField label="H2O (%)" value={h2oB} onChange={(e) => setH2oB(e.target.value)} type="number" size="small" required />
                <TextField label="CH4 (ppm)" value={ch4B} onChange={(e) => setCh4B(e.target.value)} type="number" size="small" required />
                <TextField label="d13C-CO2 (permil)" value={d13co2B} onChange={(e) => setD13co2B(e.target.value)} type="number" size="small" />
              </Box>
            </>
          )}

          {!showRepB && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setShowRepB(true)} sx={{ alignSelf: 'flex-start' }}>
              Add Replicate B
            </Button>
          )}

          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary">Field & Lab Conditions</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField label="Water temp (C)" value={waterTemp} onChange={(e) => setWaterTemp(e.target.value)} type="number" size="small" required />
            <TextField label="Field pressure (hPa)" value={pressure} onChange={(e) => setPressure(e.target.value)} type="number" size="small" required />
            <TextField label="Lab temp (C)" value={labTemp} onChange={(e) => setLabTemp(e.target.value)} type="number" size="small" />
            <TextField label="Lab pressure (atm)" value={labPressure} onChange={(e) => setLabPressure(e.target.value)} type="number" size="small" />
            <TextField label="Vol SA (mL)" value={volSa} onChange={(e) => setVolSa(e.target.value)} type="number" size="small" />
            <TextField label="Vol water (mL)" value={volWater} onChange={(e) => setVolWater(e.target.value)} type="number" size="small" />
          </Box>
        </>
      )}
    </ToolLayout>
  );
};
