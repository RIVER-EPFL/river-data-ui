import { Layout, AppBar, TitlePortal, Menu, LayoutProps } from 'react-admin';
import { CssBaseline, Typography } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

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

const CustomAppBar = () => (
  <AppBar>
    <TitlePortal />
  </AppBar>
);

const CustomMenu = () => (
  <Menu>
    <Menu.DashboardItem />
    <Typography sx={sectionHeaderSx}>Field Operations</Typography>
    <Menu.ResourceItem name="sites" />
    <Menu.ResourceItem name="sensors" />
    <Typography sx={sectionHeaderSx}>Science</Typography>
    <Menu.ResourceItem name="parameters" />
    <Menu.ResourceItem name="derived_parameters" />
    <Typography sx={sectionHeaderSx}>Admin</Typography>
    <Menu.ResourceItem name="projects" />
    <Menu.Item to="/system" primaryText="System" leftIcon={<SettingsIcon />} />
  </Menu>
);

const CustomLayout = ({ children }: LayoutProps) => (
  <>
    <CssBaseline />
    <Layout appBar={CustomAppBar} menu={CustomMenu}>{children}</Layout>
  </>
);

export default CustomLayout;
