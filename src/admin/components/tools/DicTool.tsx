import { useState, useMemo } from 'react';
import { TextField, Box } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const DicTool = () => {
  const [acidSampleWt, setAcidSampleWt] = useState('');
  const [acidWt, setAcidWt] = useState('');
  const [overpressure, setOverpressure] = useState('');
  const [saAdded, setSaAdded] = useState('');
  const [co2Dry, setCo2Dry] = useState('');
  const [d13co2, setD13co2] = useState('');
  const [labTemp, setLabTemp] = useState('22');

  const inputs = useMemo(() => ({
    acid_sample_weight_g: Number(acidSampleWt) || 0,
    acid_weight_g: Number(acidWt) || 0,
    vol_overpressure_ml: Number(overpressure) || 0,
    sa_added_ml: Number(saAdded) || 0,
    co2_dry_ppm: Number(co2Dry) || 0,
    d13co2_permil: d13co2 ? Number(d13co2) : null,
    lab_temp_c: Number(labTemp) || 22,
  }), [acidSampleWt, acidWt, overpressure, saAdded, co2Dry, d13co2, labTemp]);

  return (
    <ToolLayout toolName="dic" description="DIC concentration and d13C-DIC from acid digestion + Picarro CO2 analysis." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Acid+sample wt (g)" value={acidSampleWt} onChange={(e) => setAcidSampleWt(e.target.value)} type="number" size="small" required />
        <TextField label="Acid wt (g)" value={acidWt} onChange={(e) => setAcidWt(e.target.value)} type="number" size="small" required />
        <TextField label="Overpressure (mL)" value={overpressure} onChange={(e) => setOverpressure(e.target.value)} type="number" size="small" required />
        <TextField label="SA added (mL)" value={saAdded} onChange={(e) => setSaAdded(e.target.value)} type="number" size="small" required />
        <TextField label="CO2 dry (ppm)" value={co2Dry} onChange={(e) => setCo2Dry(e.target.value)} type="number" size="small" required />
        <TextField label="d13CO2 (permil)" value={d13co2} onChange={(e) => setD13co2(e.target.value)} type="number" size="small" helperText="Optional" />
        <TextField label="Lab temp (C)" value={labTemp} onChange={(e) => setLabTemp(e.target.value)} type="number" size="small" />
      </Box>
    </ToolLayout>
  );
};
