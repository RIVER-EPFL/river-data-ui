import { useEffect, useState, useCallback } from 'react';
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
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { StreamState } from '../../dataProvider';
import { DiscoveryWizard } from './DiscoveryWizard';
import { StreamPairDialog } from './StreamPairDialog';

const SyncStatusList = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [streams, setStreams] = useState<StreamState[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Pair dialog
  const [pairDialogOpen, setPairDialogOpen] = useState(false);
  const [pairTarget, setPairTarget] = useState<StreamState | null>(null);

  // Unpair dialog
  const [unpairDialogOpen, setUnpairDialogOpen] = useState(false);
  const [unpairTarget, setUnpairTarget] = useState<StreamState | null>(null);
  const [unpairing, setUnpairing] = useState(false);

  const refresh = useCallback(() => {
    return dataProvider
      .getSyncState()
      .then((res) => setStreams(res.data))
      .catch(() => notify('Failed to load sync status', { type: 'error' }));
  }, [dataProvider, notify]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const openPairDialog = (stream: StreamState) => {
    setPairTarget(stream);
    setPairDialogOpen(true);
  };

  const handleUnpair = async () => {
    if (!unpairTarget) return;
    setUnpairing(true);
    try {
      await dataProvider.unpairStream(unpairTarget.id);
      notify('Stream unpaired successfully', { type: 'success' });
      setUnpairDialogOpen(false);
      await refresh();
    } catch {
      notify('Failed to unpair stream', { type: 'error' });
    } finally {
      setUnpairing(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  const unpairedCount = streams.filter((s) => !s.site_parameter_id).length;

  return (
    <>
      <Title title="Data Streams" />
      {unpairedCount > 0 && (
        <Box display="flex" justifyContent="flex-end" mb={1}>
          <Button
            variant="contained"
            startIcon={<AutoFixHighIcon />}
            onClick={() => setWizardOpen(true)}
          >
            Auto-Discover & Pair ({unpairedCount} unpaired)
          </Button>
        </Box>
      )}
      <Card>
        <CardContent>
          {streams.length === 0 ? (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              No data streams registered
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell>Key</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Paired</TableCell>
                    <TableCell>Active</TableCell>
                    <TableCell>Last Data</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {streams.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.source_system}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {s.source_key}
                      </TableCell>
                      <TableCell>{s.source_name ?? '-'}</TableCell>
                      <TableCell>
                        <Chip
                          label={s.site_parameter_id ? 'Paired' : 'Unpaired'}
                          color={s.site_parameter_id ? 'success' : 'default'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={s.is_active ? 'Active' : 'Inactive'}
                          color={s.is_active ? 'success' : 'default'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {s.last_data_time ? new Date(s.last_data_time).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        {s.site_parameter_id ? (
                          <Button
                            size="small"
                            color="warning"
                            startIcon={<LinkOffIcon />}
                            onClick={() => {
                              setUnpairTarget(s);
                              setUnpairDialogOpen(true);
                            }}
                          >
                            Unpair
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            color="primary"
                            startIcon={<LinkIcon />}
                            onClick={() => openPairDialog(s)}
                          >
                            Pair
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Pair Dialog */}
      <StreamPairDialog
        open={pairDialogOpen}
        stream={pairTarget}
        onClose={() => setPairDialogOpen(false)}
        onPaired={() => refresh()}
      />

      {/* Unpair Dialog */}
      <Dialog open={unpairDialogOpen} onClose={() => setUnpairDialogOpen(false)}>
        <DialogTitle>Unpair Stream</DialogTitle>
        <DialogContent>
          <Typography>
            Remove pairing from <strong>{unpairTarget?.source_name}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnpairDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUnpair} color="warning" variant="contained" disabled={unpairing}>
            {unpairing ? 'Unpairing...' : 'Unpair'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Discovery Wizard */}
      <DiscoveryWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={() => refresh()}
      />
    </>
  );
};

export default {
  list: SyncStatusList,
};
