import { useState, useMemo, useCallback } from 'react';
import { TextField, Box, FormControlLabel, Switch } from '@mui/material';
import { ToolLayout } from './ToolLayout';
import { LoadStandardCurveButton } from './LoadStandardCurveButton';

export const DocTool = () => {
  const [rep1, setRep1] = useState('');
  const [rep2, setRep2] = useState('');
  const [rep3, setRep3] = useState('');
  const [useCurve, setUseCurve] = useState(false);
  const [slope, setSlope] = useState('');
  const [intercept, setIntercept] = useState('');

  const handleLoadCurve = useCallback((s: number, i: number) => {
    setSlope(String(s));
    setIntercept(String(i));
    setUseCurve(true);
  }, []);

  const inputs = useMemo(() => {
    const replicates = [rep1, rep2, rep3]
      .filter((v) => v !== '')
      .map(Number)
      .filter((v) => !isNaN(v));
    const result: Record<string, unknown> = { replicates };
    if (useCurve && slope && intercept) {
      result.std_curve = { slope: Number(slope), intercept: Number(intercept) };
    }
    return result;
  }, [rep1, rep2, rep3, useCurve, slope, intercept]);

  return (
    <ToolLayout toolName="doc" description="Dissolved Organic Carbon: average and standard deviation from replicates with optional standard curve correction." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField label="Replicate 1" value={rep1} onChange={(e) => setRep1(e.target.value)} type="number" size="small" />
        <TextField label="Replicate 2" value={rep2} onChange={(e) => setRep2(e.target.value)} type="number" size="small" />
        <TextField label="Replicate 3" value={rep3} onChange={(e) => setRep3(e.target.value)} type="number" size="small" />
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
