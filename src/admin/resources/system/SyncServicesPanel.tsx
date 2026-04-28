import { useEffect, useState } from 'react';
import { useNotify, useGetList, useRefresh } from 'react-admin';
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
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TablePagination,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SyncIcon from '@mui/icons-material/Sync';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { SyncService, SyncCommand, SyncEvent, ServiceCredential } from '../../dataProvider';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

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
    case 'idle': return 'success';
    case 'syncing': return 'primary';
    case 'paused': return 'warning';
    case 'error': return 'error';
    case 'starting': return 'primary';
    default: return 'default';
  }
};

const commandStatusColor = (cmd: SyncCommand): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
  if (cmd.status === 'completed' && cmd.result) {
    const errors = (cmd.result as Record<string, unknown>).errors;
    if (Array.isArray(errors) && errors.length > 0) return 'warning';
  }
  switch (cmd.status) {
    case 'pending': return 'default';
    case 'acknowledged': return 'primary';
    case 'completed': return 'success';
    case 'failed': return 'error';
    case 'expired': return 'default';
    default: return 'default';
  }
};

const syncEventStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
  switch (status) {
    case 'running': return 'primary';
    case 'completed': return 'success';
    case 'partial': return 'warning';
    case 'failed': return 'error';
    default: return 'default';
  }
};

const formatDurationMs = (ms: number | null): string => {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${secs}s`;
};

const formatDuration = (cmd: SyncCommand): string => {
  if (!cmd.completed_at) return '-';
  const ms = new Date(cmd.completed_at).getTime() - new Date(cmd.created_at).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${secs}s`;
};

export const SyncServicesPanel = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();
  const [snackbar, setSnackbar] = useState<string | null>(null);

  // Create credential dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newServiceType, setNewServiceType] = useState('');
  const [createdCredential, setCreatedCredential] = useState<{ client_id: string; client_secret: string } | null>(null);

  // Revoke dialog
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ServiceCredential | null>(null);

  // Event detail dialog
  const [selectedEvent, setSelectedEvent] = useState<SyncEvent | null>(null);

  // Sync history pagination
  const [eventsPage, setEventsPage] = useState(0);
  const [eventsPerPage, setEventsPerPage] = useState(25);

  // Command in-flight state: serviceId → command name
  const [pendingCommands, setPendingCommands] = useState<Record<string, string>>({});

  // Full sync confirmation dialog
  const [fullSyncTarget, setFullSyncTarget] = useState<SyncService | null>(null);

  // React-admin data hooks — respond to global refresh button
  const { data: services = [], isLoading: servicesLoading } = useGetList<SyncService>('sync_services', {
    sort: { field: 'updated_at', order: 'DESC' },
    pagination: { page: 1, perPage: 100 },
  });

  const { data: commands = [] } = useGetList<SyncCommand>('sync_commands', {
    sort: { field: 'created_at', order: 'DESC' },
    pagination: { page: 1, perPage: 20 },
  });

  const { data: syncEvents = [], total: eventsTotal = 0 } = useGetList<SyncEvent>('sync_events', {
    sort: { field: 'started_at', order: 'DESC' },
    pagination: { page: eventsPage + 1, perPage: eventsPerPage },
  });

  const { data: credentials = [] } = useGetList<ServiceCredential>('sync_service_credentials', {
    pagination: { page: 1, perPage: 100 },
  });

  // Auto-refresh every 10 seconds via react-admin's refresh mechanism
  useEffect(() => {
    const interval = setInterval(() => refresh(), 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleCommand = async (serviceId: string, command: string) => {
    setPendingCommands((prev) => ({ ...prev, [serviceId]: command }));
    try {
      await dataProvider.issueSyncCommand(serviceId, command);
      setSnackbar(`Command '${command}' sent`);
      refresh();
    } catch {
      notify(`Failed to send command '${command}'`, { type: 'error' });
    } finally {
      setPendingCommands((prev) => {
        const next = { ...prev };
        delete next[serviceId];
        return next;
      });
    }
  };

  const handleCreateCredential = async () => {
    if (!newServiceType.trim()) return;
    try {
      const res = await dataProvider.createServiceCredential(newServiceType.trim());
      setCreatedCredential(res.data);
      refresh();
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
      refresh();
    } catch {
      notify('Failed to revoke credential', { type: 'error' });
    }
  };

  if (servicesLoading) {
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
            <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={2}>
              {services.map((svc) => {
                const pending = pendingCommands[svc.id];
                const isBusy = !!pending;
                return (
                <Card key={svc.id} variant="outlined">
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
                    <Box display="flex" gap={0.5} mt={2}>
                      <Tooltip title="Sync">
                        <span>
                          <IconButton
                            size="small"
                            disabled={isBusy}
                            onClick={() => handleCommand(svc.id, 'trigger_sync')}
                          >
                            {pending === 'trigger_sync' ? <CircularProgress size={18} /> : <SyncIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Full Sync">
                        <span>
                          <IconButton
                            size="small"
                            disabled={isBusy}
                            onClick={() => setFullSyncTarget(svc)}
                          >
                            {pending === 'trigger_full_sync' ? <CircularProgress size={18} /> : <CloudSyncIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      {svc.status === 'paused' ? (
                        <Tooltip title="Resume">
                          <span>
                            <IconButton
                              size="small"
                              color="success"
                              disabled={isBusy}
                              onClick={() => handleCommand(svc.id, 'resume')}
                            >
                              {pending === 'resume' ? <CircularProgress size={18} /> : <PlayArrowIcon fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title="Pause">
                          <span>
                            <IconButton
                              size="small"
                              color="warning"
                              disabled={isBusy}
                              onClick={() => handleCommand(svc.id, 'pause')}
                            >
                              {pending === 'pause' ? <CircularProgress size={18} /> : <PauseIcon fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </Box>
                  </CardContent>
                </Card>
                );
              })}
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
                  <TableCell>Service Name</TableCell>
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
                  <TableCell>Result</TableCell>
                  <TableCell>Duration</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {commands.slice(0, 20).map((cmd) => {
                  const result = cmd.result as Record<string, unknown> | null;
                  const readingsCount = result?.readings_synced as number | undefined;
                  const errorCount = Array.isArray(result?.errors) ? (result.errors as unknown[]).length : 0;
                  const resultText = result
                    ? [
                        readingsCount !== undefined ? `${readingsCount} readings` : null,
                        errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : null,
                        result?.error ? 'error' : null,
                      ].filter(Boolean).join(', ') || '-'
                    : '-';

                  return (
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
                          title={cmd.result ? JSON.stringify(cmd.result, null, 2) : ''}
                        >
                          <Chip
                            label={cmd.status}
                            color={commandStatusColor(cmd)}
                            size="small"
                            variant={cmd.status === 'expired' ? 'outlined' : 'filled'}
                          />
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.85rem' }}>{resultText}</TableCell>
                      <TableCell>{formatDuration(cmd)}</TableCell>
                    </TableRow>
                  );
                })}
                {commands.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No commands yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Section 4: Sync History */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Sync History
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Service</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Readings</TableCell>
                  <TableCell>Status Events</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Errors</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {syncEvents.map((evt) => {
                  const errorList = Array.isArray(evt.errors) ? evt.errors : [];
                  return (
                    <TableRow
                      key={evt.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setSelectedEvent(evt)}
                    >
                      <TableCell>{formatRelativeTime(evt.started_at)}</TableCell>
                      <TableCell>
                        {services.find((s) => s.id === evt.service_id)?.service_type || evt.service_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={evt.event_type}
                          size="small"
                          variant="outlined"
                          color={evt.event_type === 'full_sync' ? 'primary' : evt.event_type === 'triggered' ? 'info' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={evt.status}
                          color={syncEventStatusColor(evt.status)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{evt.readings_synced}</TableCell>
                      <TableCell>{evt.status_events_synced}</TableCell>
                      <TableCell>{formatDurationMs(evt.duration_ms)}</TableCell>
                      <TableCell>
                        {errorList.length > 0 ? (
                          <Chip
                            label={`${errorList.length}`}
                            color="error"
                            size="small"
                            variant="outlined"
                          />
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {syncEvents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      No sync events yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={eventsTotal}
            page={eventsPage}
            onPageChange={(_, newPage) => setEventsPage(newPage)}
            rowsPerPage={eventsPerPage}
            onRowsPerPageChange={(e) => {
              setEventsPerPage(parseInt(e.target.value, 10));
              setEventsPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </CardContent>
      </Card>

      {/* Sync Event Detail Dialog */}
      <Dialog
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedEvent && (() => {
          const svc = services.find((s) => s.id === selectedEvent.service_id);
          const linkedCmd = selectedEvent.command_id
            ? commands.find((c) => c.id === selectedEvent.command_id)
            : null;
          const errorList = Array.isArray(selectedEvent.errors) ? selectedEvent.errors : [];
          const logList = Array.isArray(selectedEvent.log) ? selectedEvent.log : [];

          return (
            <>
              <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Sync Event Detail
                <Chip
                  label={selectedEvent.status}
                  color={syncEventStatusColor(selectedEvent.status)}
                  size="small"
                  sx={{ ml: 1 }}
                />
              </DialogTitle>
              <DialogContent>
                {/* Summary grid */}
                <Box
                  display="grid"
                  gridTemplateColumns="1fr 1fr"
                  gap={2}
                  sx={{ mb: 3 }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">Service</Typography>
                    <Typography variant="body1">
                      {svc ? `${svc.service_type} (${svc.instance_id})` : selectedEvent.service_id.slice(0, 8)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Type</Typography>
                    <Typography variant="body1">
                      <Chip
                        label={selectedEvent.event_type}
                        size="small"
                        variant="outlined"
                        color={selectedEvent.event_type === 'full_sync' ? 'primary' : selectedEvent.event_type === 'triggered' ? 'info' : 'default'}
                      />
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Started</Typography>
                    <Typography variant="body1">
                      {new Date(selectedEvent.started_at).toLocaleString()}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Completed</Typography>
                    <Typography variant="body1">
                      {selectedEvent.completed_at
                        ? new Date(selectedEvent.completed_at).toLocaleString()
                        : selectedEvent.status === 'running' ? 'In progress...' : '-'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Duration</Typography>
                    <Typography variant="body1">{formatDurationMs(selectedEvent.duration_ms)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Triggered by</Typography>
                    <Typography variant="body1">
                      {linkedCmd
                        ? `Command: ${linkedCmd.command}`
                        : selectedEvent.command_id
                          ? `Command ${selectedEvent.command_id.slice(0, 8)}...`
                          : 'Scheduled'}
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ mb: 2 }} />

                {/* Results */}
                <Typography variant="subtitle2" gutterBottom>Results</Typography>
                <Box
                  display="grid"
                  gridTemplateColumns="1fr 1fr"
                  gap={2}
                  sx={{ mb: 3 }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">Readings Synced</Typography>
                    <Typography variant="h6">{selectedEvent.readings_synced}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Status Events Synced</Typography>
                    <Typography variant="h6">{selectedEvent.status_events_synced}</Typography>
                  </Box>
                </Box>

                {/* Log */}
                {logList.length > 0 && (
                  <>
                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="subtitle2" gutterBottom>
                      Log
                    </Typography>
                    <List dense disablePadding>
                      {logList.map((entry, i) => (
                        <ListItem key={i} sx={{ pl: 0, py: 0.25 }}>
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            {entry.toLowerCase().includes('ok') || entry.toLowerCase().includes('events')
                              ? <CheckCircleOutlineIcon color="success" fontSize="small" />
                              : <InfoOutlinedIcon color="info" fontSize="small" />}
                          </ListItemIcon>
                          <ListItemText
                            primary={entry}
                            primaryTypographyProps={{
                              variant: 'body2',
                              sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                            }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}

                {/* Errors */}
                {errorList.length > 0 && (
                  <>
                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="subtitle2" gutterBottom color="error">
                      Errors ({errorList.length})
                    </Typography>
                    <List dense disablePadding>
                      {errorList.map((err, i) => (
                        <ListItem key={i} sx={{ pl: 0, py: 0.25 }}>
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            <ErrorOutlineIcon color="error" fontSize="small" />
                          </ListItemIcon>
                          <ListItemText
                            primary={err}
                            primaryTypographyProps={{
                              variant: 'body2',
                              sx: { fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' },
                            }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}

                {/* IDs */}
                <Divider sx={{ my: 2 }} />
                <Typography variant="caption" color="text.secondary" component="div" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  Event ID: {selectedEvent.id}
                  {selectedEvent.command_id && (<><br />Command ID: {selectedEvent.command_id}</>)}
                  <br />Service ID: {selectedEvent.service_id}
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSelectedEvent(null)} variant="contained">
                  Close
                </Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      {/* Create Credential Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Service Credential</DialogTitle>
        <DialogContent>
          {!createdCredential ? (
            <TextField
              autoFocus
              margin="dense"
              label="Service Name"
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

      {/* Full Sync Confirmation Dialog */}
      <Dialog open={!!fullSyncTarget} onClose={() => setFullSyncTarget(null)}>
        <DialogTitle>Confirm Full Sync</DialogTitle>
        <DialogContent>
          <Typography>
            Run a full sync on <strong>{fullSyncTarget?.service_type}</strong>? This rescans all
            historical data from the source and may take a long time.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFullSyncTarget(null)}>Cancel</Button>
          <Button
            onClick={() => {
              if (fullSyncTarget) {
                handleCommand(fullSyncTarget.id, 'trigger_full_sync');
              }
              setFullSyncTarget(null);
            }}
            variant="contained"
          >
            Full Sync
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
