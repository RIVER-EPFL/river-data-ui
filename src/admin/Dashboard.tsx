import { useEffect, useState } from 'react';
import { useDataProvider, Title } from 'react-admin';
import {
  Card,
  CardContent,
  Typography,
  Grid,
  Button,
  CircularProgress,
  Box,
  Chip,
  Alert,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import type { RiverDataProvider } from './dataProvider';

interface SyncState {
  parameter_id: string;
  last_data_time: string | null;
  last_sync_attempt: string | null;
  sync_status: string | null;
  error_message: string | null;
  retry_count: number | null;
}

const Dashboard = () => {
  const dataProvider = useDataProvider() as RiverDataProvider;
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [siteCount, setSiteCount] = useState<number | null>(null);
  const [parameterCount, setParameterCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [syncRes, sitesRes, paramsRes] = await Promise.all([
          dataProvider.getSyncState(),
          dataProvider.getList('sites', {
            pagination: { page: 1, perPage: 1 },
            sort: { field: 'id', order: 'ASC' },
            filter: {},
          }),
          dataProvider.getList('parameters', {
            pagination: { page: 1, perPage: 1 },
            sort: { field: 'id', order: 'ASC' },
            filter: {},
          }),
        ]);
        setSyncStates(syncRes.data as SyncState[]);
        setSiteCount(sitesRes.total ?? null);
        setParameterCount(paramsRes.total ?? null);
      } catch (e) {
        console.error('Failed to fetch dashboard data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [dataProvider]);

  const handleTriggerSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await dataProvider.triggerSync();
      setSyncMessage('Sync triggered successfully');
    } catch {
      setSyncMessage('Failed to trigger sync');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
        <CircularProgress />
      </Box>
    );
  }

  const errorStates = syncStates.filter((s) => s.sync_status === 'error');
  const successStates = syncStates.filter((s) => s.sync_status === 'success');

  return (
    <>
      <Title title="River Data Admin" />
      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Sites
              </Typography>
              <Typography variant="h4">{siteCount ?? '-'}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Parameters
              </Typography>
              <Typography variant="h4">{parameterCount ?? '-'}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Sync OK
              </Typography>
              <Typography variant="h4" color="success.main">
                {successStates.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                Sync Errors
              </Typography>
              <Typography variant="h4" color="error.main">
                {errorStates.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Typography variant="h6">Sync Status</Typography>
                <Button
                  variant="contained"
                  startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}
                  onClick={handleTriggerSync}
                  disabled={syncing}
                >
                  Trigger Sync
                </Button>
              </Box>
              {syncMessage && (
                <Alert
                  severity={syncMessage.includes('Failed') ? 'error' : 'success'}
                  sx={{ mb: 2 }}
                  onClose={() => setSyncMessage(null)}
                >
                  {syncMessage}
                </Alert>
              )}
              {syncStates.length === 0 ? (
                <Typography color="textSecondary">No sync state data available.</Typography>
              ) : (
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {syncStates.map((s) => (
                    <Chip
                      key={s.parameter_id}
                      label={`${s.parameter_id.slice(0, 8)}... ${s.sync_status ?? 'unknown'}`}
                      color={
                        s.sync_status === 'success'
                          ? 'success'
                          : s.sync_status === 'error'
                            ? 'error'
                            : 'default'
                      }
                      size="small"
                      title={s.error_message ?? undefined}
                    />
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
};

export default Dashboard;
