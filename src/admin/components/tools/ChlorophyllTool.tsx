import { useState, useMemo } from 'react';
import { TextField, Box, MenuItem } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const ChlorophyllTool = () => {
  const [method, setMethod] = useState('acid');
  const [fluorBefore, setFluorBefore] = useState('');
  const [fluorAfter, setFluorAfter] = useState('');
  const [slope, setSlope] = useState('');
  const [intercept, setIntercept] = useState('');

  const inputs = useMemo(() => ({
    method,
    fluorescence_before: Number(fluorBefore) || 0,
    fluorescence_after: method === 'acid' ? (Number(fluorAfter) || 0) : undefined,
    slope: Number(slope) || 0,
    intercept: Number(intercept) || 0,
  }), [method, fluorBefore, fluorAfter, slope, intercept]);

  return (
    <ToolLayout toolName="chlorophyll" description="Chlorophyll-a concentration from fluorescence with standard curve." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Method" value={method} onChange={(e) => setMethod(e.target.value)} select size="small" sx={{ minWidth: 120 }}>
          <MenuItem value="acid">Acid correction</MenuItem>
          <MenuItem value="no_acid">No acid</MenuItem>
        </TextField>
        <TextField label="Fluorescence (before)" value={fluorBefore} onChange={(e) => setFluorBefore(e.target.value)} type="number" size="small" required />
        {method === 'acid' && (
          <TextField label="Fluorescence (after acid)" value={fluorAfter} onChange={(e) => setFluorAfter(e.target.value)} type="number" size="small" required />
        )}
        <TextField label="Slope" value={slope} onChange={(e) => setSlope(e.target.value)} type="number" size="small" required />
        <TextField label="Intercept" value={intercept} onChange={(e) => setIntercept(e.target.value)} type="number" size="small" required />
      </Box>
    </ToolLayout>
  );
};
