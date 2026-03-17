import { useState, useEffect, useCallback } from 'react';
import { Layout, AppBar, TitlePortal, Menu, LayoutProps } from 'react-admin';
import { CssBaseline, Typography, IconButton, Badge } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import ScienceIcon from '@mui/icons-material/Science';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import BuildIcon from '@mui/icons-material/Build';
import HikingIcon from '@mui/icons-material/Hiking';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SearchBar from './components/SearchBar';
import { StatusIndicators } from './components/StatusIndicators';
import { AlarmNotificationPanel } from './components/AlarmNotificationPanel';
import { useRiverDataProvider } from './useRiverDataProvider';

const sectionHeaderSx = {
  px: 2,
  pt: 2,
  pb: 0.5,
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'text.secondary',
};

const BADGE_REFRESH_INTERVAL = 60_000;

const CustomAppBar = () => {
  const dataProvider = useRiverDataProvider();
  const [alarmCount, setAlarmCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await dataProvider.getAlarmSummary();
      setAlarmCount(data.total);
    } catch (err) {
      console.error('Failed to fetch alarm count:', err);
    }
  }, [dataProvider]);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, BADGE_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCount]);

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
    <Typography sx={sectionHeaderSx}>Field Operations</Typography>
    <Menu.ResourceItem name="sites" />
    <Menu.ResourceItem name="sensors" />
    <Menu.Item to="/admin/field-trip" primaryText="Field Trip Entry" leftIcon={<HikingIcon />} />
    <Typography sx={sectionHeaderSx}>Science</Typography>
    <Menu.ResourceItem name="parameters" />
    <Menu.ResourceItem name="derived_parameters" />
    <Menu.ResourceItem name="standard_curves" />
    <Menu.Item to="/admin/grab-samples" primaryText="Enter Grab Samples" leftIcon={<ScienceIcon />} />
    <Typography sx={sectionHeaderSx}>Analysis</Typography>
    <Menu.Item to="/admin/compare" primaryText="Station Comparison" leftIcon={<CompareArrowsIcon />} />
    <Menu.Item to="/admin/tools" primaryText="Tools" leftIcon={<BuildIcon />} />
    <Typography sx={sectionHeaderSx}>Admin</Typography>
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
