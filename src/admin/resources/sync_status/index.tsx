import { useEffect, useState } from 'react';
import { Title, useNotify } from 'react-admin';
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Box,
  Button,
  Alert,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { useRiverDataProvider } from '../../useRiverDataProvider';

interface SyncState {
  site_parameter_id: string;
  last_data_time: string | null;
  last_sync_attempt: string | null;
  sync_status: string | null;
  error_message: string | null;
  retry_count: number | null;
  last_full_sync: string | null;
}

const SyncStatusList = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    dataProvider
      .getSyncState()
      .then((res: { data: unknown }) => setSyncStates(res.data as SyncState[]))
      .catch(() => notify('Failed to load sync status', { type: 'error' }))
      .finally(() => setLoading(false));
  }, [dataProvider, notify]);

  const handleTriggerSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await dataProvider.triggerSync();
      setSyncMessage('Full sync triggered successfully');
      const res = await dataProvider.getSyncState();
      setSyncStates(res.data as SyncState[]);
    } catch {
      setSyncMessage('Failed to trigger sync');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  const statusColor = (status: string | null): 'success' | 'error' | 'warning' | 'default' => {
    if (status === 'success') return 'success';
    if (status === 'error') return 'error';
    if (status === 'pending') return 'warning';
    return 'default';
  };

  return (
    <>
      <Title title="Sync Status" />
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box />
            <Button
              variant="contained"
              startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <SyncIcon />}
              onClick={handleTriggerSync}
              disabled={syncing}
            >
              Trigger Full Sync
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
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Parameter ID</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Last Data</TableCell>
                  <TableCell>Last Sync</TableCell>
                  <TableCell>Last Full Sync</TableCell>
                  <TableCell>Retries</TableCell>
                  <TableCell>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {syncStates.map((s) => (
                  <TableRow key={s.site_parameter_id}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {s.site_parameter_id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={s.sync_status ?? 'unknown'}
                        color={statusColor(s.sync_status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      {s.last_data_time ? new Date(s.last_data_time).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {s.last_sync_attempt ? new Date(s.last_sync_attempt).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {s.last_full_sync ? new Date(s.last_full_sync).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>{s.retry_count ?? 0}</TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.error_message ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </>
  );
};

export default {
  list: SyncStatusList,
};
