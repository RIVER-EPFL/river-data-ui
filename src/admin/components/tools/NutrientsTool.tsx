import { useState, useMemo } from 'react';
import { TextField, Box, Typography } from '@mui/material';
import { ToolLayout } from './ToolLayout';

interface SpeciesSection {
  key: string;
  label: string;
}

const SPECIES: SpeciesSection[] = [
  { key: 'P', label: 'PO4 (P)' },
  { key: 'NH4', label: 'NH4' },
  { key: 'NOx', label: 'NOx' },
  { key: 'NO2', label: 'NO2' },
  { key: 'TDP', label: 'TDP' },
  { key: 'TDN', label: 'TDN' },
];

export const NutrientsTool = () => {
  // State: each species has 3 replicate fields (A, B, C)
  const [values, setValues] = useState<Record<string, [string, string, string]>>(() => {
    const init: Record<string, [string, string, string]> = {};
    for (const s of SPECIES) {
      init[s.key] = ['', '', ''];
    }
    return init;
  });

  const setReplicate = (species: string, index: number, value: string) => {
    setValues((prev) => {
      const triplet = [...prev[species]] as [string, string, string];
      triplet[index] = value;
      return { ...prev, [species]: triplet };
    });
  };

  const inputs = useMemo(() => {
    const species: Record<string, number[]> = {};
    for (const s of SPECIES) {
      const reps = values[s.key]
        .filter((v) => v !== '')
        .map(Number)
        .filter((v) => !isNaN(v));
      if (reps.length > 0) {
        species[s.key] = reps;
      }
    }
    return { species };
  }, [values]);

  return (
    <ToolLayout
      toolName="nutrients"
      description="Multi-species nutrient replicates: PO4, NH4, NOx, NO2, TDP, TDN. NO3 is computed automatically as NOx minus NO2 when both are provided. Leave sections blank if not measured."
      inputs={inputs}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {SPECIES.map((s) => (
          <Box key={s.key}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {s.label}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Rep A"
                value={values[s.key][0]}
                onChange={(e) => setReplicate(s.key, 0, e.target.value)}
                type="number"
                size="small"
              />
              <TextField
                label="Rep B"
                value={values[s.key][1]}
                onChange={(e) => setReplicate(s.key, 1, e.target.value)}
                type="number"
                size="small"
              />
              <TextField
                label="Rep C"
                value={values[s.key][2]}
                onChange={(e) => setReplicate(s.key, 2, e.target.value)}
                type="number"
                size="small"
              />
            </Box>
          </Box>
        ))}
      </Box>
    </ToolLayout>
  );
};
