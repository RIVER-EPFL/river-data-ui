import { Layout, AppBar, TitlePortal, LayoutProps } from 'react-admin';
import { CssBaseline, Button, Box } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';

const CustomAppBar = () => (
  <AppBar>
    <TitlePortal />
    <Box flex={1} />
    <Button
      color="inherit"
      href="/dashboard"
      startIcon={<DashboardIcon />}
      sx={{ textTransform: 'none', mr: 2 }}
    >
      Go to Dashboard
    </Button>
  </AppBar>
);

const CustomLayout = ({ children }: LayoutProps) => (
  <>
    <CssBaseline />
    <Layout appBar={CustomAppBar}>{children}</Layout>
  </>
);

export default CustomLayout;
