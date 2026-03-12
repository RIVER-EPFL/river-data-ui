import { useEffect, useState, useCallback } from 'react';
import { useNotify } from 'react-admin';
import {
  Card,
  CardContent,
  Typography,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Tooltip,
  Snackbar,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SyncIcon from '@mui/icons-material/Sync';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { SyncService, SyncCommand, ServiceCredential } from '../../dataProvider';

const healthColor = (service: SyncService) => {
  if (!service.last_heartbeat) return 'grey';
  const ageMs = Date.now() - new Date(service.last_heartbeat).getTime();
  if (ageMs < 90_000) return '#4caf50';
  if (ageMs < 300_000) return '#ff9800';
  return '#f44336';
};

const statusChipColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
  switch (status) {
    case 'running': return 'success';
    case 'paused': return 'warning';
    case 'error': return 'error';
    case 'starting': return 'primary';
    default: return 'default';
  }
};

const commandStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
  switch (status) {
    case 'pending': return 'default';
    case 'acknowledged': return 'primary';
    case 'completed': return 'success';
    case 'failed': return 'error';
    case 'expired': return 'default';
    default: return 'default';
  }
};

const formatRelativeTime = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatDuration = (cmd: SyncCommand): string => {
  const end = cmd.completed_at || cmd.acknowledged_at;
  if (!end) return '-';
  const ms = new Date(end).getTime() - new Date(cmd.created_at).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${secs}s`;
};

export const SyncServicesPanel = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [services, setServices] = useState<SyncService[]>([]);
  const [commands, setCommands] = useState<SyncCommand[]>([]);
  const [credentials, setCredentials] = useState<ServiceCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  // Create credential dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newServiceType, setNewServiceType] = useState('');
  const [createdCredential, setCreatedCredential] = useState<{ client_id: string; client_secret: string } | null>(null);

  // Revoke dialog
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ServiceCredential | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [svcRes, cmdRes, credRes] = await Promise.all([
        dataProvider.getSyncServices(),
        dataProvider.getSyncCommands(),
        dataProvider.listServiceCredentials(),
      ]);
      setServices(svcRes.data);
      setCommands(cmdRes.data);
      setCredentials(credRes.data);
    } catch {
      // Silently fail on refresh
    }
  }, [dataProvider]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleCommand = async (serviceId: string, command: string) => {
    try {
      await dataProvider.issueSyncCommand(serviceId, command);
      setSnackbar(`Command '${command}' sent`);
      await refresh();
    } catch {
      notify(`Failed to send command '${command}'`, { type: 'error' });
    }
  };

  const handleCreateCredential = async () => {
    if (!newServiceType.trim()) return;
    try {
      const res = await dataProvider.createServiceCredential(newServiceType.trim());
      setCreatedCredential(res.data);
      await refresh();
    } catch {
      notify('Failed to create credential', { type: 'error' });
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await dataProvider.revokeSyncService(revokeTarget.id);
      setRevokeDialogOpen(false);
      setRevokeTarget(null);
      setSnackbar('Credential revoked');
      await refresh();
    } catch {
      notify('Failed to revoke credential', { type: 'error' });
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {/* Section 1: Service Health Cards */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Sync Services
          </Typography>
          {services.length === 0 ? (
            <Alert severity="info">
              No sync services registered. Create a credential below and deploy a service to get
              started.
            </Alert>
          ) : (
            <Box display="flex" flexWrap="wrap" gap={2}>
              {services.map((svc) => (
                <Card key={svc.id} variant="outlined" sx={{ minWidth: 320, flex: '1 1 320px', maxWidth: 480 }}>
                  <CardContent>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            backgroundColor: healthColor(svc),
                          }}
                        />
                        <Typography variant="subtitle1" fontWeight="bold">
                          {svc.service_type.charAt(0).toUpperCase() + svc.service_type.slice(1)} Sync
                        </Typography>
                      </Box>
                      <Chip label={svc.status} color={statusChipColor(svc.status)} size="small" />
                    </Box>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      instance: {svc.instance_id}
                    </Typography>
                    <Typography variant="body2">
                      Current: {svc.current_operation || 'Idle'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: healthColor(svc) }}>
                      Last heartbeat: {formatRelativeTime(svc.last_heartbeat)}
                    </Typography>
                    <Typography variant="body2">
                      Last sync: {formatRelativeTime(svc.last_sync_completed_at)}
                    </Typography>
                    {svc.status === 'error' && svc.last_error && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {svc.last_error}
                      </Alert>
                    )}
                    <Box display="flex" gap={1} mt={2}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SyncIcon />}
                        onClick={() => handleCommand(svc.id, 'trigger_sync')}
                      >
                        Sync
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SyncIcon />}
                        onClick={() => handleCommand(svc.id, 'trigger_full_sync')}
                      >
                        Full Sync
                      </Button>
                      {svc.status === 'paused' ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          startIcon={<PlayArrowIcon />}
                          onClick={() => handleCommand(svc.id, 'resume')}
                        >
                          Resume
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          startIcon={<PauseIcon />}
                          onClick={() => handleCommand(svc.id, 'pause')}
                        >
                          Pause
                        </Button>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Service Credentials */}
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Typography variant="h6">Service Credentials</Typography>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                setCreateDialogOpen(true);
                setNewServiceType('');
                setCreatedCredential(null);
              }}
            >
              Create Credential
            </Button>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Client ID</TableCell>
                  <TableCell>Service Type</TableCell>
                  <TableCell>Linked Service</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {credentials.map((cred) => (
                  <TableRow key={cred.id}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      {cred.client_id}
                    </TableCell>
                    <TableCell>{cred.service_type}</TableCell>
                    <TableCell>
                      {cred.service_id
                        ? services.find((s) => s.id === cred.service_id)?.instance_id || cred.service_id.slice(0, 8)
                        : '\u2014'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={cred.revoked ? 'Revoked' : 'Active'}
                        color={cred.revoked ? 'error' : 'success'}
                        size="small"
                        variant={cred.revoked ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell>{new Date(cred.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {!cred.revoked && (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            setRevokeTarget(cred);
                            setRevokeDialogOpen(true);
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {credentials.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No credentials created yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Section 3: Command History */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Commands
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Service</TableCell>
                  <TableCell>Command</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Duration</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {commands.slice(0, 20).map((cmd) => (
                  <TableRow key={cmd.id}>
                    <TableCell>{formatRelativeTime(cmd.created_at)}</TableCell>
                    <TableCell>
                      {services.find((s) => s.id === cmd.service_id)?.service_type || cmd.service_id.slice(0, 8)}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      {cmd.command}
                    </TableCell>
                    <TableCell>
                      <Tooltip
                        title={cmd.status === 'failed' && cmd.result ? JSON.stringify(cmd.result) : ''}
                      >
                        <Chip
                          label={cmd.status}
                          color={commandStatusColor(cmd.status)}
                          size="small"
                          variant={cmd.status === 'expired' ? 'outlined' : 'filled'}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell>{formatDuration(cmd)}</TableCell>
                  </TableRow>
                ))}
                {commands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      No commands yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Credential Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Service Credential</DialogTitle>
        <DialogContent>
          {!createdCredential ? (
            <TextField
              autoFocus
              margin="dense"
              label="Service Type"
              fullWidth
              variant="outlined"
              value={newServiceType}
              onChange={(e) => setNewServiceType(e.target.value)}
              placeholder="e.g., vaisala, campbell"
            />
          ) : (
            <Box>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Save this secret now — it won&apos;t be shown again.
              </Alert>
              <Typography variant="body2" gutterBottom>
                Client ID:
              </Typography>
              <TextField
                fullWidth
                value={createdCredential.client_id}
                InputProps={{ readOnly: true }}
                size="small"
                sx={{ mb: 2, fontFamily: 'monospace' }}
              />
              <Typography variant="body2" gutterBottom>
                Client Secret:
              </Typography>
              <Box display="flex" gap={1}>
                <TextField
                  fullWidth
                  value={createdCredential.client_secret}
                  InputProps={{
                    readOnly: true,
                    sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                  }}
                  size="small"
                />
                <IconButton
                  onClick={() => {
                    navigator.clipboard.writeText(createdCredential.client_secret);
                    setSnackbar('Secret copied to clipboard');
                  }}
                >
                  <ContentCopyIcon />
                </IconButton>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {!createdCredential ? (
            <>
              <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateCredential} variant="contained" disabled={!newServiceType.trim()}>
                Create
              </Button>
            </>
          ) : (
            <Button onClick={() => setCreateDialogOpen(false)} variant="contained">
              Done
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Revoke Credential Dialog */}
      <Dialog open={revokeDialogOpen} onClose={() => setRevokeDialogOpen(false)}>
        <DialogTitle>Revoke Credential</DialogTitle>
        <DialogContent>
          <Typography>
            Revoke credentials for <strong>{revokeTarget?.client_id}</strong>? The service will lose
            access on its next heartbeat and must be redeployed with new credentials.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRevoke} color="error" variant="contained">
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />
    </Box>
  );
};
