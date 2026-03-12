import { useEffect, useState } from 'react';
import { useNotify } from 'react-admin';
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
} from '@mui/material';
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

export const SyncStatusPanel = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dataProvider
      .getSyncState()
      .then((res: { data: unknown }) => setSyncStates(res.data as SyncState[]))
      .catch(() => notify('Failed to load sync status', { type: 'error' }))
      .finally(() => setLoading(false));
  }, [dataProvider, notify]);

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
    <Card>
      <CardContent>
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
  );
};
