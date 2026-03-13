import { useState, useMemo } from 'react';
import { TextField, Box } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const TssAfdmTool = () => {
  const [dried, setDried] = useState('');
  const [prefilt, setPrefilt] = useState('');
  const [ashed, setAshed] = useState('');
  const [vol, setVol] = useState('');

  const inputs = useMemo(() => ({
    wgt_dried_g: Number(dried) || 0,
    wgt_prefilt_g: Number(prefilt) || 0,
    wgt_ashed_g: ashed ? Number(ashed) : null,
    vol_filtered_ml: Number(vol) || 0,
  }), [dried, prefilt, ashed, vol]);

  return (
    <ToolLayout toolName="tss_afdm" description="Total Suspended Solids and Ash-Free Dry Mass from filter weights." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Dried weight (g)" value={dried} onChange={(e) => setDried(e.target.value)} type="number" size="small" required />
        <TextField label="Pre-filter weight (g)" value={prefilt} onChange={(e) => setPrefilt(e.target.value)} type="number" size="small" required />
        <TextField label="Ashed weight (g)" value={ashed} onChange={(e) => setAshed(e.target.value)} type="number" size="small" helperText="Optional, for AFDM" />
        <TextField label="Volume filtered (mL)" value={vol} onChange={(e) => setVol(e.target.value)} type="number" size="small" required />
      </Box>
    </ToolLayout>
  );
};
