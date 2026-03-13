import { useState, useMemo, useCallback } from 'react';
import { TextField, Box, Typography, Button, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ToolLayout } from './ToolLayout';

interface IonEntry {
  name: string;
  concentration_mg_l: string;
}

const DEFAULT_CATIONS: IonEntry[] = [
  { name: 'Na', concentration_mg_l: '' },
  { name: 'K', concentration_mg_l: '' },
  { name: 'Mg', concentration_mg_l: '' },
  { name: 'Ca', concentration_mg_l: '' },
];

const DEFAULT_ANIONS: IonEntry[] = [
  { name: 'Cl', concentration_mg_l: '' },
  { name: 'SO4', concentration_mg_l: '' },
  { name: 'NO3', concentration_mg_l: '' },
  { name: 'HCO3', concentration_mg_l: '' },
];

const IonRow = ({
  entry,
  onChange,
  onRemove,
}: {
  entry: IonEntry;
  onChange: (e: IonEntry) => void;
  onRemove: () => void;
}) => (
  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
    <TextField label="Ion" value={entry.name} onChange={(e) => onChange({ ...entry, name: e.target.value })} size="small" sx={{ width: 100 }} />
    <TextField label="mg/L" value={entry.concentration_mg_l} onChange={(e) => onChange({ ...entry, concentration_mg_l: e.target.value })} type="number" size="small" sx={{ width: 120 }} />
    <IconButton size="small" onClick={onRemove}><DeleteIcon fontSize="small" /></IconButton>
  </Box>
);

export const IonsTool = () => {
  const [cations, setCations] = useState<IonEntry[]>(DEFAULT_CATIONS);
  const [anions, setAnions] = useState<IonEntry[]>(DEFAULT_ANIONS);

  const updateIon = useCallback(
    (list: IonEntry[], setList: (l: IonEntry[]) => void, idx: number, entry: IonEntry) => {
      const next = [...list];
      next[idx] = entry;
      setList(next);
    },
    [],
  );

  const inputs = useMemo(() => ({
    cations: cations
      .filter((c) => c.name && c.concentration_mg_l)
      .map((c) => ({ name: c.name, concentration_mg_l: Number(c.concentration_mg_l) })),
    anions: anions
      .filter((a) => a.name && a.concentration_mg_l)
      .map((a) => ({ name: a.name, concentration_mg_l: Number(a.concentration_mg_l) })),
  }), [cations, anions]);

  return (
    <ToolLayout toolName="ions" description="IC ion charge balance verification. Enter cation and anion concentrations in mg/L." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Cations (+)</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {cations.map((c, i) => (
              <IonRow key={i} entry={c} onChange={(e) => updateIon(cations, setCations, i, e)} onRemove={() => setCations(cations.filter((_, j) => j !== i))} />
            ))}
            <Button size="small" startIcon={<AddIcon />} onClick={() => setCations([...cations, { name: '', concentration_mg_l: '' }])}>
              Add cation
            </Button>
          </Box>
        </Box>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Anions (-)</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {anions.map((a, i) => (
              <IonRow key={i} entry={a} onChange={(e) => updateIon(anions, setAnions, i, e)} onRemove={() => setAnions(anions.filter((_, j) => j !== i))} />
            ))}
            <Button size="small" startIcon={<AddIcon />} onClick={() => setAnions([...anions, { name: '', concentration_mg_l: '' }])}>
              Add anion
            </Button>
          </Box>
        </Box>
      </Box>
    </ToolLayout>
  );
};
