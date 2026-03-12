import { useState } from 'react';
import { Title } from 'react-admin';
import {
  Box,
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Grid2 as Grid,
  IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import WaterIcon from '@mui/icons-material/Water';
import { DischargeTool } from '../components/tools/DischargeTool';

interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  component: React.ComponentType;
}

const tools: ToolDefinition[] = [
  {
    id: 'discharge',
    name: 'Discharge Calculator',
    description: 'Calculate stream discharge from salt dilution breakthrough curves (Q = V * C_inj / integral C(t)dt)',
    icon: <WaterIcon sx={{ fontSize: 48, color: 'primary.main' }} />,
    component: DischargeTool,
  },
];

export const ToolsPage = () => {
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const active = tools.find((t) => t.id === activeTool);

  if (active) {
    const Component = active.component;
    return (
      <Box>
        <Title title={active.name} />
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
          <IconButton onClick={() => setActiveTool(null)} size="small">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6">{active.name}</Typography>
        </Box>
        <Component />
      </Box>
    );
  }

  return (
    <Box>
      <Title title="Tools" />
      <Typography variant="h5" sx={{ mb: 3 }}>
        Analysis Tools
      </Typography>
      <Grid container spacing={3}>
        {tools.map((tool) => (
          <Grid key={tool.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardActionArea onClick={() => setActiveTool(tool.id)}>
                <CardContent
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    py: 4,
                    textAlign: 'center',
                  }}
                >
                  {tool.icon}
                  <Typography variant="h6" sx={{ mt: 2 }}>
                    {tool.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {tool.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};
