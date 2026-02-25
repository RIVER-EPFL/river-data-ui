import { useState } from 'react';
import { Title } from 'react-admin';
import { Box, Tab, Tabs, Paper } from '@mui/material';
import { SyncStatusPanel } from './SyncStatusPanel';
import { ApiTokensPanel } from './ApiTokensPanel';
import { ParameterTypesPanel } from './ParameterTypesPanel';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export const SystemPage = () => {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Title title="System" />
      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab label="Sync Status" />
          <Tab label="API Tokens" />
          <Tab label="Parameter Types" />
        </Tabs>
      </Paper>
      <TabPanel value={tab} index={0}>
        <SyncStatusPanel />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <ApiTokensPanel />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <ParameterTypesPanel />
      </TabPanel>
    </Box>
  );
};
