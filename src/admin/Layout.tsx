import { useState } from 'react';
import { Layout, AppBar, TitlePortal, Menu, LayoutProps } from 'react-admin';
import { CssBaseline, Typography, IconButton, Badge } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import ScienceIcon from '@mui/icons-material/Science';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import BuildIcon from '@mui/icons-material/Build';

import NotificationsIcon from '@mui/icons-material/Notifications';
import RssFeedIcon from '@mui/icons-material/RssFeed';
import SearchBar from './components/SearchBar';
import { StatusIndicators } from './components/StatusIndicators';
import { AlarmNotificationPanel } from './components/AlarmNotificationPanel';
import { useAlarmBadgeCount } from './hooks/useAlarmBadgeCount';
import { snippets } from './themeSnippets';

const CustomAppBar = () => {
  const alarmCount = useAlarmBadgeCount();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <AppBar>
        <TitlePortal />
        <StatusIndicators />
        <SearchBar />
        <IconButton color="inherit" onClick={() => setPanelOpen(true)} sx={{ ml: 1 }}>
          <Badge badgeContent={alarmCount} color="error" max={99}>
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </AppBar>
      <AlarmNotificationPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
};

const CustomMenu = () => (
  <Menu>
    <Menu.DashboardItem />
    <Typography sx={snippets.navSectionLabel}>Monitor</Typography>
    <Menu.ResourceItem name="sites" />
    <Menu.ResourceItem name="sensors" />
    <Menu.Item to="/admin/streams" primaryText="Streams" leftIcon={<RssFeedIcon />} />
    <Typography sx={snippets.navSectionLabel}>Field Work</Typography>
    <Menu.Item to="/admin/grab-samples" primaryText="Grab Samples" leftIcon={<ScienceIcon />} />
    <Typography sx={snippets.navSectionLabel}>Analyze</Typography>
    <Menu.Item to="/admin/compare" primaryText="Compare Sites" leftIcon={<CompareArrowsIcon />} />
    <Menu.Item to="/admin/tools" primaryText="Tools" leftIcon={<BuildIcon />} />
    <Typography sx={snippets.navSectionLabel}>Configure</Typography>
    <Menu.ResourceItem name="parameters" />
    <Menu.ResourceItem name="derived_parameters" />
    <Menu.ResourceItem name="standard_curves" />
    <Menu.ResourceItem name="constants" />
    <Menu.ResourceItem name="projects" />
    <Menu.ResourceItem name="users" />
    <Menu.Item to="/admin/system" primaryText="System" leftIcon={<SettingsIcon />} />
  </Menu>
);

const CustomLayout = ({ children }: LayoutProps) => (
  <>
    <CssBaseline />
    <Layout appBar={CustomAppBar} menu={CustomMenu}>{children}</Layout>
  </>
);

export default CustomLayout;
