import { Layout, AppBar, TitlePortal, Menu, LayoutProps } from 'react-admin';
import { CssBaseline } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

const CustomAppBar = () => (
  <AppBar>
    <TitlePortal />
  </AppBar>
);

const CustomMenu = () => (
  <Menu>
    <Menu.DashboardItem />
    <Menu.ResourceItem name="sites" />
    <Menu.ResourceItem name="sensors" />
    <Menu.ResourceItem name="derived_parameters" />
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
