import { useState, useRef } from 'react';
import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  DateField,
  FunctionField,
  useNotify,
  useRefresh,
  useRecordContext,
  TopToolbar,
  useListContext,
} from 'react-admin';
import {
  Chip,
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { StreamState, StreamStats } from '../../dataProvider';
import { DiscoveryWizard } from '../sync_status/DiscoveryWizard';
import { GroupedDiscoveryWizard } from '../sync_status/GroupedDiscoveryWizard';
import { PairingWizard } from '../sync_status/PairingWizard';
import { StreamPairDialog } from '../sync_status/StreamPairDialog';

// ============================================================================
// Action Buttons (use record context from Datagrid)
// ============================================================================

const PairUnpairButton = ({
  onPair,
  onUnpair,
}: {
  onPair: (stream: StreamState) => void;
  onUnpair: (stream: StreamState) => void;
}) => {
  const record = useRecordContext<StreamState>();
  if (!record) return null;

  return record.site_parameter_id ? (
    <Button size="small" color="warning" startIcon={<LinkOffIcon />} onClick={() => onUnpair(record)}>
      Unpair
    </Button>
  ) : (
    <Button size="small" color="primary" startIcon={<LinkIcon />} onClick={() => onPair(record)}>
      Pair
    </Button>
  );
};

const StreamNameButton = ({ onStats }: { onStats: (stream: StreamState) => void }) => {
  const record = useRecordContext<StreamState>();
  if (!record) return null;
  return (
    <Tooltip title="View stats">
      <Button
        size="small"
        sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
        onClick={() => onStats(record)}
      >
        {record.source_name ?? '-'}
      </Button>
    </Tooltip>
  );
};

// ============================================================================
// Toolbar with filter toggles and discovery button
// ============================================================================

const DataStreamToolbar = ({ onOpenPairingWizard }: { onOpenPairingWizard: () => void }) => {
  const { filterValues, setFilters, total } = useListContext();
  const currentFilter = filterValues.site_parameter_id === undefined
    ? 'all'
    : filterValues.site_parameter_id === null
      ? 'unpaired'
      : 'paired';

  const handleFilterChange = (_: React.MouseEvent<HTMLElement>, value: string | null) => {
    if (!value) return;
    const newFilters = { ...filterValues };
    if (value === 'all') {
      delete newFilters.site_parameter_id;
    } else if (value === 'unpaired') {
      newFilters.site_parameter_id = null;
    } else {
      // "paired" — filter for non-null. CrudCrate supports __not_null suffix
      newFilters.site_parameter_id = '__not_null';
    }
    setFilters(newFilters, {});
  };

  return (
    <TopToolbar sx={{ width: '100%', justifyContent: 'space-between' }}>
      <ToggleButtonGroup
        size="small"
        value={currentFilter}
        exclusive
        onChange={handleFilterChange}
      >
        <ToggleButton value="all">All ({total ?? '...'})</ToggleButton>
        <ToggleButton value="unpaired">Unpaired</ToggleButton>
        <ToggleButton value="paired">Paired</ToggleButton>
      </ToggleButtonGroup>
      <Button
        variant="contained"
        size="small"
        startIcon={<AutoFixHighIcon />}
        onClick={onOpenPairingWizard}
      >
        New Pairing Plan
      </Button>
    </TopToolbar>
  );
};

// ============================================================================
// Stats Dialog
// ============================================================================

const StatsDialog = ({
  open,
  onClose,
  stream,
  stats,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  stream: StreamState | null;
  stats: StreamStats | null;
  loading: boolean;
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <InfoOutlinedIcon color="info" />
      Stream Details
    </DialogTitle>
    <DialogContent>
      {stream && (
        <Box>
          <Typography variant="body2" gutterBottom>
            <strong>Name:</strong> {stream.source_name ?? '-'}
          </Typography>
          <Typography variant="body2" gutterBottom>
            <strong>Path:</strong> {stream.source_path ?? '-'}
          </Typography>
          <Typography variant="body2" gutterBottom>
            <strong>Source:</strong> {stream.source_system} / {stream.source_key}
          </Typography>
          {stream.metadata && (
            <>
              {(stream.metadata as Record<string, unknown>).units && (
                <Typography variant="body2" gutterBottom>
                  <strong>Units:</strong> {String((stream.metadata as Record<string, unknown>).units)}
                </Typography>
              )}
              {(stream.metadata as Record<string, unknown>).device && (
                <Typography variant="body2" gutterBottom>
                  <strong>Logger Serial:</strong>{' '}
                  {String(
                    ((stream.metadata as Record<string, unknown>).device as Record<string, unknown>)
                      ?.logger_serial ?? '-',
                  )}
                </Typography>
              )}
            </>
          )}
          {loading ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={24} />
            </Box>
          ) : stats ? (
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2} sx={{ mt: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Reading Count
                </Typography>
                <Typography variant="h6">{stats.reading_count.toLocaleString()}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Latest Value
                </Typography>
                <Typography variant="h6">{stats.latest_value?.toFixed(2) ?? '-'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  First Reading
                </Typography>
                <Typography variant="body2">
                  {stats.min_time ? new Date(stats.min_time).toLocaleString() : '-'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Last Reading
                </Typography>
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
      <Button onClick={onClose} variant="contained">
        Close
      </Button>
    </DialogActions>
  </Dialog>
);

// ============================================================================
// Main Panel
// ============================================================================

export const SyncStatusPanel = () => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

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
  const statsRequestVersion = useRef(0);

  // Discovery wizards (legacy, kept for backward compatibility)
  const [wizardOpen, setWizardOpen] = useState(false);
  const [groupedWizardOpen, setGroupedWizardOpen] = useState(false);
  const [groupedSourceSystem, setGroupedSourceSystem] = useState('nomis');

  // Pairing wizard
  const [pairingWizardOpen, setPairingWizardOpen] = useState(false);

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
      refresh();
    } catch {
      notify('Failed to unpair stream', { type: 'error' });
    } finally {
      setUnpairing(false);
    }
  };

  const openStatsDialog = async (stream: StreamState) => {
    const version = ++statsRequestVersion.current;
    setStatsTarget(stream);
    setStatsDialogOpen(true);
    setStats(null);
    setLoadingStats(true);
    try {
      const res = await dataProvider.getStreamStats(stream.id);
      if (statsRequestVersion.current !== version) return;
      setStats(res.data);
    } catch {
      if (statsRequestVersion.current !== version) return;
      notify('Failed to load stream stats', { type: 'error' });
    } finally {
      if (statsRequestVersion.current === version) {
        setLoadingStats(false);
      }
    }
  };

  return (
    <>
      <List
        resource="data_streams"
        sort={{ field: 'discovered_at', order: 'DESC' }}
        perPage={25}
        actions={
          <DataStreamToolbar
            onOpenPairingWizard={() => setPairingWizardOpen(true)}
          />
        }
        empty={
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No data streams registered
          </Typography>
        }
        title=" "
        sx={{ '& .RaList-main': { mt: 0 } }}
      >
        <Datagrid bulkActionButtons={false} size="small">
          <TextField source="source_system" label="Source" />
          <FunctionField
            label="Key"
            render={(record: StreamState) => (
              <Typography sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                {record.source_key}
              </Typography>
            )}
          />
          <FunctionField
            label="Name"
            render={() => <StreamNameButton onStats={openStatsDialog} />}
          />
          <FunctionField
            label="Paired"
            render={(record: StreamState) => (
              <Chip
                label={record.site_parameter_id ? 'Paired' : 'Unpaired'}
                color={record.site_parameter_id ? 'success' : 'default'}
                size="small"
                variant="outlined"
              />
            )}
          />
          <BooleanField source="is_active" label="Active" />
          <DateField source="last_data_time" label="Last Data" showTime />
          <FunctionField
            label="Actions"
            render={() => (
              <PairUnpairButton onPair={openPairDialog} onUnpair={openUnpairDialog} />
            )}
          />
        </Datagrid>
      </List>

      {/* Pair Dialog */}
      <StreamPairDialog
        open={pairDialogOpen}
        stream={pairTarget}
        onClose={() => setPairDialogOpen(false)}
        onPaired={() => {
          refresh();
          setPairDialogOpen(false);
        }}
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
      <StatsDialog
        open={statsDialogOpen}
        onClose={() => setStatsDialogOpen(false)}
        stream={statsTarget}
        stats={stats}
        loading={loadingStats}
      />

      {/* Per-Stream Discovery Wizard */}
      <DiscoveryWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={() => refresh()}
      />

      {/* Grouped Bulk Discovery Wizard */}
      <GroupedDiscoveryWizard
        open={groupedWizardOpen}
        sourceSystem={groupedSourceSystem}
        onClose={() => setGroupedWizardOpen(false)}
        onComplete={() => refresh()}
      />

      {/* Pairing Plan Wizard */}
      <PairingWizard
        open={pairingWizardOpen}
        onClose={() => setPairingWizardOpen(false)}
        onComplete={() => refresh()}
      />
    </>
  );
};
