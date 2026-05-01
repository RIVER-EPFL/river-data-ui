import { useState } from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { MultiStationChart } from '../components/charts/MultiStationChart';
import { CompareScatterPanel } from '../components/charts/CompareScatterPanel';

type CompareMode = 'time' | 'scatter';

export const ComparePage = () => {
  const [mode, setMode] = useState<CompareMode>('time');

  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5">Site Comparison</Typography>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => v && setMode(v)}
          size="small"
        >
          <ToggleButton value="time">Time Series</ToggleButton>
          <ToggleButton value="scatter">Scatter</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {mode === 'time' ? <MultiStationChart /> : <CompareScatterPanel />}
    </Box>
  );
};
