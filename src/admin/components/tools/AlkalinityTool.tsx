import { useState, useMemo } from 'react';
import { TextField, Box } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const AlkalinityTool = () => {
  const [sampleWeight, setSampleWeight] = useState('');
  const [acidNormality, setAcidNormality] = useState('0.02');
  const [titrantVolume, setTitrantVolume] = useState('');

  const inputs = useMemo(() => ({
    sample_weight_g: Number(sampleWeight) || 0,
    acid_normality: Number(acidNormality) || 0,
    titrant_volume_ml: Number(titrantVolume) || 0,
  }), [sampleWeight, acidNormality, titrantVolume]);

  return (
    <ToolLayout toolName="alkalinity" description="Gran titration alkalinity in meq/L and mg/L CaCO3." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField label="Sample weight (g)" value={sampleWeight} onChange={(e) => setSampleWeight(e.target.value)} type="number" size="small" required />
        <TextField label="Acid normality (N)" value={acidNormality} onChange={(e) => setAcidNormality(e.target.value)} type="number" size="small" required />
        <TextField label="Titrant volume (mL)" value={titrantVolume} onChange={(e) => setTitrantVolume(e.target.value)} type="number" size="small" required />
      </Box>
    </ToolLayout>
  );
};
