import { useState, useMemo } from 'react';
import { TextField, Box, Typography, Button, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ToolLayout } from './ToolLayout';

const DiameterRow = ({
  value,
  index,
  onChange,
  onRemove,
}: {
  value: string;
  index: number;
  onChange: (v: string) => void;
  onRemove: () => void;
}) => (
  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
    <TextField label={`Diameter ${index + 1} (cm)`} value={value} onChange={(e) => onChange(e.target.value)} type="number" size="small" sx={{ width: 180 }} />
    <IconButton size="small" onClick={onRemove}><DeleteIcon fontSize="small" /></IconButton>
  </Box>
);

export const BenthicTool = () => {
  const [diameters, setDiameters] = useState<string[]>(['', '', '']);
  const [afdmGFilter, setAfdmGFilter] = useState('');
  const [chlaUgL, setChlaUgL] = useState('');
  const [volumeFilteredMl, setVolumeFilteredMl] = useState('');
  const [totalVolumeMl, setTotalVolumeMl] = useState('');

  const inputs = useMemo(() => ({
    diameters_cm: diameters.filter((d) => d !== '').map(Number).filter((d) => !isNaN(d)),
    afdm_g_filter: afdmGFilter ? Number(afdmGFilter) : null,
    chla_ug_l: chlaUgL ? Number(chlaUgL) : null,
    volume_filtered_ml: Number(volumeFilteredMl) || 0,
    total_volume_ml: Number(totalVolumeMl) || 0,
  }), [diameters, afdmGFilter, chlaUgL, volumeFilteredMl, totalVolumeMl]);

  return (
    <ToolLayout toolName="benthic" description="Benthic normalizations: rock surface area from diameter measurements and AFDM/Chl-a per m²." inputs={inputs}>
      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Rock Diameters</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {diameters.map((d, i) => (
              <DiameterRow
                key={i}
                value={d}
                index={i}
                onChange={(v) => {
                  const next = [...diameters];
                  next[i] = v;
                  setDiameters(next);
                }}
                onRemove={() => setDiameters(diameters.filter((_, j) => j !== i))}
              />
            ))}
            <Button size="small" startIcon={<AddIcon />} onClick={() => setDiameters([...diameters, ''])}>
              Add diameter
            </Button>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle2">Sample Parameters</Typography>
          <TextField label="Volume filtered (mL)" value={volumeFilteredMl} onChange={(e) => setVolumeFilteredMl(e.target.value)} type="number" size="small" required />
          <TextField label="Total volume (mL)" value={totalVolumeMl} onChange={(e) => setTotalVolumeMl(e.target.value)} type="number" size="small" required />
          <TextField label="AFDM (g/filter)" value={afdmGFilter} onChange={(e) => setAfdmGFilter(e.target.value)} type="number" size="small" />
          <TextField label="Chl-a (µg/L)" value={chlaUgL} onChange={(e) => setChlaUgL(e.target.value)} type="number" size="small" />
        </Box>
      </Box>
    </ToolLayout>
  );
};
