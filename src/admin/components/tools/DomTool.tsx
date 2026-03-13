import { useState, useMemo } from 'react';
import { TextField, Box } from '@mui/material';
import { ToolLayout } from './ToolLayout';

export const DomTool = () => {
  const [a254, setA254] = useState('');
  const [docAvgPpb, setDocAvgPpb] = useState('');
  const [absNumerator, setAbsNumerator] = useState('');
  const [absDenominator, setAbsDenominator] = useState('');

  const inputs = useMemo(() => ({
    a254: a254 ? Number(a254) : null,
    doc_avg_ppb: docAvgPpb ? Number(docAvgPpb) : null,
    abs_numerator: absNumerator ? Number(absNumerator) : null,
    abs_denominator: absDenominator ? Number(absDenominator) : null,
  }), [a254, docAvgPpb, absNumerator, absDenominator]);

  return (
    <ToolLayout toolName="dom" description="DOM indices: SUVA from A254 and DOC, and absorbance ratio (e.g. E2:E3 = A250/A365)." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField label="A254" value={a254} onChange={(e) => setA254(e.target.value)} type="number" size="small" />
        <TextField label="DOC avg (ppb)" value={docAvgPpb} onChange={(e) => setDocAvgPpb(e.target.value)} type="number" size="small" />
        <TextField label="Abs numerator (e.g. A250)" value={absNumerator} onChange={(e) => setAbsNumerator(e.target.value)} type="number" size="small" />
        <TextField label="Abs denominator (e.g. A365)" value={absDenominator} onChange={(e) => setAbsDenominator(e.target.value)} type="number" size="small" />
      </Box>
    </ToolLayout>
  );
};
