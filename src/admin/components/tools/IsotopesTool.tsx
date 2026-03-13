import { useState, useMemo } from 'react';
import { TextField, Box } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const IsotopesTool = () => {
  const [dD, setDD] = useState('');
  const [d18O, setD18O] = useState('');
  const [d17O, setD17O] = useState('');

  const inputs = useMemo(() => ({
    d_d: dD ? Number(dD) : null,
    d18o: d18O ? Number(d18O) : null,
    d17o: d17O ? Number(d17O) : null,
  }), [dD, d18O, d17O]);

  return (
    <ToolLayout toolName="isotopes" description="Deuterium excess (d-excess = dD - 8*d18O) and 17O excess." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField label="dD (permil)" value={dD} onChange={(e) => setDD(e.target.value)} type="number" size="small" />
        <TextField label="d18O (permil)" value={d18O} onChange={(e) => setD18O(e.target.value)} type="number" size="small" />
        <TextField label="d17O (permil)" value={d17O} onChange={(e) => setD17O(e.target.value)} type="number" size="small" />
      </Box>
    </ToolLayout>
  );
};
