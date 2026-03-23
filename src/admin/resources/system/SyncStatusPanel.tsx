import { useEffect, useState, useCallback } from 'react';
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
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { StreamState, StreamStats } from '../../dataProvider';
import { DiscoveryWizard } from '../sync_status/DiscoveryWizard';
import { StreamPairDialog } from '../sync_status/StreamPairDialog';

export const SyncStatusPanel = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [streams, setStreams] = useState<StreamState[]>([]);
  const [loading, setLoading] = useState(true);

  // Pair dialog
  const [pairDialogOpen, setPairDialogOpen] = useState(false);
  const [pairTarget, setPairTarget] = useState<StreamState | null>(null);

  // Unpair dialog
  const [unpairDialogOpen, setUnpairDialogOpen] = useState(false);
  const [unpairTarget, setUnpairTarget] = useState<StreamState | null>(null);
  const [unpairing, setUnpairing] = useState(false);

  // Stats dialog
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [statsTarget, setStatsTarget] = useState<StreamState | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Discovery wizard
  const [wizardOpen, setWizardOpen] = useState(false);

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

  const openUnpairDialog = (stream: StreamState) => {
    setUnpairTarget(stream);
    setUnpairDialogOpen(true);
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

  const openStatsDialog = async (stream: StreamState) => {
    setStatsTarget(stream);
    setStatsDialogOpen(true);
    setStats(null);
    setLoadingStats(true);
    try {
      const res = await dataProvider.getStreamStats(stream.id);
      setStats(res.data);
    } catch {
      notify('Failed to load stream stats', { type: 'error' });
    } finally {
      setLoadingStats(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (streams.length === 0) {
    return (
      <Card>
        <CardContent>
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
            No data streams registered
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const unpairedCount = streams.filter((s) => !s.site_parameter_id).length;

  return (
    <>
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
                    <TableCell>
                      <Tooltip title="View stats">
                        <Button
                          size="small"
                          sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                          onClick={() => openStatsDialog(s)}
                        >
                          {s.source_name ?? '-'}
                        </Button>
                      </Tooltip>
                    </TableCell>
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
                          onClick={() => openUnpairDialog(s)}
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
            Remove pairing from <strong>{unpairTarget?.source_name}</strong>? Readings will remain
            but will be excluded from charts and aggregates until re-paired.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnpairDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUnpair} color="warning" variant="contained" disabled={unpairing}>
            {unpairing ? 'Unpairing...' : 'Unpair'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stats Dialog */}
      <Dialog open={statsDialogOpen} onClose={() => setStatsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InfoOutlinedIcon color="info" />
          Stream Details
        </DialogTitle>
        <DialogContent>
          {statsTarget && (
            <Box>
              <Typography variant="body2" gutterBottom>
                <strong>Name:</strong> {statsTarget.source_name ?? '-'}
              </Typography>
              <Typography variant="body2" gutterBottom>
                <strong>Path:</strong> {statsTarget.source_path ?? '-'}
              </Typography>
              <Typography variant="body2" gutterBottom>
                <strong>Source:</strong> {statsTarget.source_system} / {statsTarget.source_key}
              </Typography>
              {statsTarget.metadata && (
                <>
                  {(statsTarget.metadata as Record<string, unknown>).units && (
                    <Typography variant="body2" gutterBottom>
                      <strong>Units:</strong> {String((statsTarget.metadata as Record<string, unknown>).units)}
                    </Typography>
                  )}
                  {(statsTarget.metadata as Record<string, unknown>).device && (
                    <Typography variant="body2" gutterBottom>
                      <strong>Logger Serial:</strong>{' '}
                      {String(((statsTarget.metadata as Record<string, unknown>).device as Record<string, unknown>)?.logger_serial ?? '-')}
                    </Typography>
                  )}
                </>
              )}
              {loadingStats ? (
                <Box display="flex" justifyContent="center" py={2}>
                  <CircularProgress size={24} />
                </Box>
              ) : stats ? (
                <Box
                  display="grid"
                  gridTemplateColumns="1fr 1fr"
                  gap={2}
                  sx={{ mt: 2 }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">Reading Count</Typography>
                    <Typography variant="h6">{stats.reading_count.toLocaleString()}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Latest Value</Typography>
                    <Typography variant="h6">{stats.latest_value?.toFixed(2) ?? '-'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">First Reading</Typography>
                    <Typography variant="body2">
                      {stats.min_time ? new Date(stats.min_time).toLocaleString() : '-'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Last Reading</Typography>
                    <Typography variant="body2">
                      {stats.max_time ? new Date(stats.max_time).toLocaleString() : '-'}
                    </Typography>
                  </Box>
                </Box>
              ) : null}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatsDialogOpen(false)} variant="contained">
            Close
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
