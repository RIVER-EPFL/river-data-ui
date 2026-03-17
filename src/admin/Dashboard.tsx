import { useRef } from 'react';
import { Title } from 'react-admin';
import { Box } from '@mui/material';
import { SiteMap } from './components/dashboard/SiteMap';
import ChartsDashboard from './components/dashboard/ChartsDashboard';
import type { ChartsDashboardRef } from './components/dashboard/ChartsDashboard';

const Dashboard = () => {
  const chartsRef = useRef<ChartsDashboardRef>(null);

  const handleSiteClick = (siteId: string) => {
    chartsRef.current?.selectSite(siteId);
  };

  return (
    <>
      <Title title="River Data Admin" />
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          alignItems: 'flex-start',
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
        <Box
          sx={{
            flex: '0 0 440px',
            position: { md: 'sticky' },
            top: { md: 64 },
            height: { xs: 350, md: 'calc(75vh - 60px)' },
            minWidth: 300,
          }}
        >
          <SiteMap onSiteClick={handleSiteClick} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ChartsDashboard ref={chartsRef} />
        </Box>
      </Box>
    </>
  );
};

export default Dashboard;
