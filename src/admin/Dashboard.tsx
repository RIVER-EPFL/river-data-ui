import { Title } from 'react-admin';
import { SiteMap } from './components/dashboard/SiteMap';
import { SummaryCards } from './components/dashboard/SummaryCards';
import ChartsDashboard from './components/dashboard/ChartsDashboard';

const Dashboard = () => {
  return (
    <>
      <Title title="River Data Admin" />
      <SummaryCards />
      <SiteMap />
      <ChartsDashboard />
    </>
  );
};

export default Dashboard;
