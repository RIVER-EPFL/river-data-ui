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
import ScienceIcon from '@mui/icons-material/Science';
import BubbleChartIcon from '@mui/icons-material/BubbleChart';
import BalanceIcon from '@mui/icons-material/Balance';
import GrainIcon from '@mui/icons-material/Grain';
import OpacityIcon from '@mui/icons-material/Opacity';
import Co2Icon from '@mui/icons-material/Co2';
import FilterDramaIcon from '@mui/icons-material/FilterDrama';
import LandscapeIcon from '@mui/icons-material/Landscape';
import BlurOnIcon from '@mui/icons-material/BlurOn';
import TerrainIcon from '@mui/icons-material/Terrain';
import AirIcon from '@mui/icons-material/Air';
import WavesIcon from '@mui/icons-material/Waves';
import { DischargeTool } from '../components/tools/DischargeTool';
import { DocTool } from '../components/tools/DocTool';
import { TssAfdmTool } from '../components/tools/TssAfdmTool';
import { AlkalinityTool } from '../components/tools/AlkalinityTool';
import { Pco2Tool } from '../components/tools/Pco2Tool';
import { DicTool } from '../components/tools/DicTool';
import { ChlorophyllTool } from '../components/tools/ChlorophyllTool';
import { IonsTool } from '../components/tools/IonsTool';
import { IsotopesTool } from '../components/tools/IsotopesTool';
import { DomTool } from '../components/tools/DomTool';
import { FieldDataTool } from '../components/tools/FieldDataTool';
import { Co2AirTool } from '../components/tools/Co2AirTool';
import { BenthicTool } from '../components/tools/BenthicTool';

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
    description: 'Calculate stream discharge from salt dilution breakthrough curves',
    icon: <WaterIcon sx={{ fontSize: 48, color: 'primary.main' }} />,
    component: DischargeTool,
  },
  {
    id: 'doc',
    name: 'DOC',
    description: 'Dissolved Organic Carbon: replicate average/SD with standard curve correction',
    icon: <OpacityIcon sx={{ fontSize: 48, color: '#8B4513' }} />,
    component: DocTool,
  },
  {
    id: 'tss_afdm',
    name: 'TSS / AFDM',
    description: 'Total Suspended Solids and Ash-Free Dry Mass from filter weights',
    icon: <GrainIcon sx={{ fontSize: 48, color: '#795548' }} />,
    component: TssAfdmTool,
  },
  {
    id: 'alkalinity',
    name: 'Alkalinity',
    description: 'Gran titration alkalinity (meq/L and mg/L CaCO3)',
    icon: <BalanceIcon sx={{ fontSize: 48, color: '#607D8B' }} />,
    component: AlkalinityTool,
  },
  {
    id: 'pco2',
    name: 'pCO2',
    description: 'Partial pressure of CO2 from headspace equilibration',
    icon: <Co2Icon sx={{ fontSize: 48, color: '#F44336' }} />,
    component: Pco2Tool,
  },
  {
    id: 'dic',
    name: 'DIC',
    description: 'Dissolved Inorganic Carbon from acid digestion + Picarro analysis',
    icon: <BubbleChartIcon sx={{ fontSize: 48, color: '#2196F3' }} />,
    component: DicTool,
  },
  {
    id: 'chlorophyll',
    name: 'Chlorophyll-a',
    description: 'Chlorophyll-a from fluorescence (acid and no-acid methods)',
    icon: <ScienceIcon sx={{ fontSize: 48, color: '#4CAF50' }} />,
    component: ChlorophyllTool,
  },
  {
    id: 'ions',
    name: 'Ion Charge Balance',
    description: 'IC ion charge balance verification (cations vs anions)',
    icon: <FilterDramaIcon sx={{ fontSize: 48, color: '#9C27B0' }} />,
    component: IonsTool,
  },
  {
    id: 'isotopes',
    name: 'Isotopes',
    description: 'Deuterium excess and 17O excess calculations',
    icon: <LandscapeIcon sx={{ fontSize: 48, color: '#00BCD4' }} />,
    component: IsotopesTool,
  },
  {
    id: 'dom',
    name: 'DOM Indices',
    description: 'SUVA and absorbance ratios (E2:E3, E4:E6) from UV-Vis measurements',
    icon: <BlurOnIcon sx={{ fontSize: 48, color: '#FF9800' }} />,
    component: DomTool,
  },
  {
    id: 'field_data',
    name: 'Field Data',
    description: 'Barometric pressure from altitude and CO2 correction',
    icon: <TerrainIcon sx={{ fontSize: 48, color: '#6D4C41' }} />,
    component: FieldDataTool,
  },
  {
    id: 'co2_air',
    name: 'CO2/CH4 Air',
    description: 'CO2 and CH4 dry concentration from wet Picarro measurements',
    icon: <AirIcon sx={{ fontSize: 48, color: '#78909C' }} />,
    component: Co2AirTool,
  },
  {
    id: 'benthic',
    name: 'Benthic',
    description: 'Rock surface area and benthic AFDM/Chl-a per m² normalizations',
    icon: <WavesIcon sx={{ fontSize: 48, color: '#26A69A' }} />,
    component: BenthicTool,
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
