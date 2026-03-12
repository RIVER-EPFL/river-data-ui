import { Box, Typography } from '@mui/material';
import { MultiStationChart } from '../components/charts/MultiStationChart';

export const ComparePage = () => (
  <Box sx={{ p: 2, maxWidth: 1400, mx: 'auto' }}>
    <Typography variant="h5" sx={{ mb: 2 }}>
      Station Comparison
    </Typography>
    <MultiStationChart />
  </Box>
);
