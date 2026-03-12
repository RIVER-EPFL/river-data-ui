import { useState } from 'react';
import { Title } from 'react-admin';
import { Box, Tab, Tabs, Paper } from '@mui/material';
import { SyncServicesPanel } from './SyncServicesPanel';
import { SyncStatusPanel } from './SyncStatusPanel';
import { ApiTokensPanel } from './ApiTokensPanel';
import { ParametersPanel } from './ParametersPanel';

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
          <Tab label="Services" />
          <Tab label="Sync Status" />
          <Tab label="API Tokens" />
          <Tab label="Parameters" />
        </Tabs>
      </Paper>
      <TabPanel value={tab} index={0}>
        <SyncServicesPanel />
      </TabPanel>
      <TabPanel value={tab} index={1}>
        <SyncStatusPanel />
      </TabPanel>
      <TabPanel value={tab} index={2}>
        <ApiTokensPanel />
      </TabPanel>
      <TabPanel value={tab} index={3}>
        <ParametersPanel />
      </TabPanel>
    </Box>
  );
};
