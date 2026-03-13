import { useState, useMemo } from 'react';
import { TextField, Box, MenuItem } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const Pco2Tool = () => {
  const [co2aq, setCo2aq] = useState('');
  const [waterTemp, setWaterTemp] = useState('');
  const [pressure, setPressure] = useState('');
  const [variant, setVariant] = useState('simple');

  const inputs = useMemo(() => ({
    co2_aq_umol: Number(co2aq) || 0,
    water_temp_c: Number(waterTemp) || 0,
    pressure_hpa: pressure ? Number(pressure) : null,
    variant,
  }), [co2aq, waterTemp, pressure, variant]);

  return (
    <ToolLayout toolName="pco2" description="pCO2 from headspace CO2aq concentration using Henry's law." inputs={inputs}>
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
    </ToolLayout>
  );
};
