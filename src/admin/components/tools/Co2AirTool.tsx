import { useState, useMemo } from 'react';
import { TextField, Box } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const Co2AirTool = () => {
  const [co2Wet, setCo2Wet] = useState('');
  const [ch4Wet, setCh4Wet] = useState('');
  const [h2oPercent, setH2oPercent] = useState('');

  const inputs = useMemo(() => ({
    co2_wet: co2Wet ? Number(co2Wet) : null,
    ch4_wet: ch4Wet ? Number(ch4Wet) : null,
    h2o_percent: Number(h2oPercent) || 0,
  }), [co2Wet, ch4Wet, h2oPercent]);

  return (
    <ToolLayout toolName="co2_air" description="CO2 and CH4 dry concentration from wet measurements, corrected for water vapor." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField label="CO2 wet (ppm)" value={co2Wet} onChange={(e) => setCo2Wet(e.target.value)} type="number" size="small" />
        <TextField label="CH4 wet (ppm)" value={ch4Wet} onChange={(e) => setCh4Wet(e.target.value)} type="number" size="small" />
        <TextField label="H2O (%)" value={h2oPercent} onChange={(e) => setH2oPercent(e.target.value)} type="number" size="small" required />
      </Box>
    </ToolLayout>
  );
};
