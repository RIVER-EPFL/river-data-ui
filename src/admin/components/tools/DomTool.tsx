import { useState, useMemo } from 'react';
import { TextField, Box, Typography } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const DomTool = () => {
  const [a254, setA254] = useState('');
  const [docAvgPpb, setDocAvgPpb] = useState('');
  const [absNumerator, setAbsNumerator] = useState('');
  const [absDenominator, setAbsDenominator] = useState('');

  // Fluorescence peaks
  const [peakA, setPeakA] = useState('');
  const [peakC, setPeakC] = useState('');
  const [peakM, setPeakM] = useState('');
  const [peakT, setPeakT] = useState('');

  const inputs = useMemo(() => ({
    a254: a254 ? Number(a254) : null,
    doc_avg_ppb: docAvgPpb ? Number(docAvgPpb) : null,
    abs_numerator: absNumerator ? Number(absNumerator) : null,
    abs_denominator: absDenominator ? Number(absDenominator) : null,
    peak_a: peakA ? Number(peakA) : null,
    peak_c: peakC ? Number(peakC) : null,
    peak_m: peakM ? Number(peakM) : null,
    peak_t: peakT ? Number(peakT) : null,
  }), [a254, docAvgPpb, absNumerator, absDenominator, peakA, peakC, peakM, peakT]);

  return (
    <ToolLayout toolName="dom" description="DOM indices: SUVA from A254 and DOC, absorbance ratio (e.g. E2:E3 = A250/A365), and fluorescence peak ratios." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="A254" value={a254} onChange={(e) => setA254(e.target.value)} type="number" />
        <TextField label="DOC avg (ppb)" value={docAvgPpb} onChange={(e) => setDocAvgPpb(e.target.value)} type="number" />
        <TextField label="Abs numerator (e.g. A250)" value={absNumerator} onChange={(e) => setAbsNumerator(e.target.value)} type="number" />
        <TextField label="Abs denominator (e.g. A365)" value={absDenominator} onChange={(e) => setAbsDenominator(e.target.value)} type="number" />
      </Box>
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Fluorescence Peaks</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="Peak A" value={peakA} onChange={(e) => setPeakA(e.target.value)} type="number" />
        <TextField label="Peak C" value={peakC} onChange={(e) => setPeakC(e.target.value)} type="number" />
        <TextField label="Peak M" value={peakM} onChange={(e) => setPeakM(e.target.value)} type="number" />
        <TextField label="Peak T" value={peakT} onChange={(e) => setPeakT(e.target.value)} type="number" />
      </Box>
    </ToolLayout>
  );
};
