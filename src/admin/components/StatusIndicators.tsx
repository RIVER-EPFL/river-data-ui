import { useEffect, useState, useCallback, useMemo } from 'react';
import { useGetList } from 'react-admin';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Chip,
  Tooltip,
  Popover,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Button,
  Divider,
  IconButton,
} from '@mui/material';
import SignalWifiOffIcon from '@mui/icons-material/SignalWifiOff';
import SyncIcon from '@mui/icons-material/Sync';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useRiverDataProvider } from '../useRiverDataProvider';
import type { SyncEvent } from '../dataProvider';

interface SyncState {
  site_parameter_id: string;
  last_data_time: string | null;
}

interface SiteParameterRecord {
  id: string;
  site_id: string;
}

const STALE_THRESHOLD_MS = 60 * 60 * 1000;
const REFRESH_INTERVAL = 60_000;
const ACK_STORAGE_KEY = 'river-data-sync-error-ack';

function loadAckedIds(): string[] {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAckedIds(ids: string[]) {
  localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(ids));
}

const formatRelative = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const StatusIndicators = () => {
  const dataProvider = useRiverDataProvider();
  const navigate = useNavigate();

  const { data: siteParameters } = useGetList<SiteParameterRecord>(
    'site_parameters',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
    },
  );

  const [staleSiteCount, setStaleSiteCount] = useState(0);
  const [failedEvents, setFailedEvents] = useState<SyncEvent[]>([]);
  const [syncLabel, setSyncLabel] = useState('');
  const [syncRunning, setSyncRunning] = useState(false);
  const [ackedIds, setAckedIds] = useState<string[]>(loadAckedIds);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const ackedSet = useMemo(() => new Set(ackedIds), [ackedIds]);

  const unackedErrors = useMemo(
    () => failedEvents.filter((e) => !ackedSet.has(e.id)),
    [failedEvents, ackedSet],
  );

  const refresh = useCallback(async () => {
    // Sync events → error count + last sync
    try {
      const { data: events } = await dataProvider.getSyncEvents();
      // All failed/partial events — no time window. They persist until acknowledged.
      const failed = events.filter(
        (e: SyncEvent) => e.status === 'failed' || e.status === 'partial',
      );
      setFailedEvents(failed);

      // Prune acked IDs for events no longer returned by the API
      const failedIds = new Set(failed.map((e) => e.id));
      setAckedIds((prev) => {
        const pruned = prev.filter((id) => failedIds.has(id));
        if (pruned.length !== prev.length) saveAckedIds(pruned);
        return pruned;
      });

      const latest = events[0];
      if (!latest) {
        setSyncLabel('Never synced');
        setSyncRunning(false);
      } else if (latest.status === 'running') {
        setSyncLabel('Syncing...');
        setSyncRunning(true);
      } else {
        const time = latest.completed_at ?? latest.started_at;
        setSyncLabel(formatRelative(time));
        setSyncRunning(false);
      }
    } catch (err) {
      console.error('Failed to fetch sync events:', err);
      setSyncLabel('N/A');
      setSyncRunning(false);
    }

    // Sync state → stale sites
    try {
      const res = await dataProvider.getSyncState();
      const states = res.data as SyncState[];
      if (!Array.isArray(states) || !siteParameters?.length) return;

      const spToSite = new Map<string, string>();
      for (const sp of siteParameters) spToSite.set(sp.id, sp.site_id);

      const siteLastData = new Map<string, number>();
      for (const s of states) {
        const siteId = spToSite.get(s.site_parameter_id);
        if (!siteId || !s.last_data_time) continue;
        const ts = new Date(s.last_data_time).getTime();
        const current = siteLastData.get(siteId) ?? 0;
        if (ts > current) siteLastData.set(siteId, ts);
      }

      const now = Date.now();
      let stale = 0;
      for (const ts of siteLastData.values()) {
        if (now - ts > STALE_THRESHOLD_MS) stale++;
      }
      setStaleSiteCount(stale);
    } catch (err) {
      console.error('Failed to fetch sync state for stale site count:', err);
    }
  }, [dataProvider, siteParameters]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleAck = (eventId: string) => {
    setAckedIds((prev) => {
      const next = [...prev, eventId];
      saveAckedIds(next);
      return next;
    });
  };

  const handleAckAll = () => {
    const allIds = failedEvents.map((e) => e.id);
    setAckedIds(allIds);
    saveAckedIds(allIds);
  };

  const hasErrors = unackedErrors.length > 0;
  const syncChipColor = hasErrors
    ? 'error'
    : syncRunning
      ? 'info'
      : syncLabel === 'N/A' || syncLabel === 'Never synced'
        ? 'default'
        : 'success';

  const syncTooltip = hasErrors
    ? `${unackedErrors.length} sync error${unackedErrors.length > 1 ? 's' : ''} — click to view`
    : `Last sync: ${syncLabel}`;

  const handleSyncChipClick = (event: React.MouseEvent<HTMLElement>) => {
    if (hasErrors) {
      setAnchorEl(event.currentTarget);
    } else {
      navigate('/admin/system');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mx: 1 }}>
      {staleSiteCount > 0 && (
        <Tooltip
          title={`${staleSiteCount} site${staleSiteCount > 1 ? 's' : ''} with no data for >1h`}
        >
          <Chip
            icon={<SignalWifiOffIcon />}
            label={`${staleSiteCount} stale`}
            size="small"
            color="warning"
            variant="filled"
            onClick={() => navigate('/admin/sites')}
            sx={{
              height: 26,
              cursor: 'pointer',
              '& .MuiChip-icon': { fontSize: 16 },
              '& .MuiChip-label': { fontSize: '0.75rem', fontWeight: 600 },
            }}
          />
        </Tooltip>
      )}

      <Tooltip title={syncTooltip}>
        <Chip
          icon={hasErrors ? <SyncProblemIcon /> : <SyncIcon />}
          label={
            hasErrors
              ? `${unackedErrors.length} error${unackedErrors.length > 1 ? 's' : ''}`
              : syncLabel
          }
          size="small"
          color={syncChipColor}
          variant="filled"
          onClick={handleSyncChipClick}
          sx={{
            height: 26,
            cursor: 'pointer',
            '& .MuiChip-icon': { fontSize: 16 },
            '& .MuiChip-label': { fontSize: '0.75rem', fontWeight: 600 },
          }}
        />
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: 380, maxHeight: 420, overflow: 'auto' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2,
              pt: 1.5,
              pb: 1,
            }}
          >
            <Typography variant="subtitle1" fontWeight={600}>
              Sync Errors ({unackedErrors.length})
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {unackedErrors.length > 0 && (
                <Button size="small" onClick={handleAckAll}>
                  Clear all
                </Button>
              )}
              <IconButton
                size="small"
                title="View full sync history"
                onClick={() => {
                  setAnchorEl(null);
                  navigate('/admin/system');
                }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
          <Divider />
          {unackedErrors.length === 0 ? (
            <Typography
              sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}
            >
              No unacknowledged errors
            </Typography>
          ) : (
            <List disablePadding dense>
              {unackedErrors.map((evt, i) => {
                const errorSummary =
                  evt.errors && evt.errors.length > 0
                    ? evt.errors[0]
                    : evt.status === 'partial'
                      ? 'Partial sync'
                      : 'Sync failed';

                return (
                  <ListItem
                    key={evt.id}
                    disablePadding
                    divider={i < unackedErrors.length - 1}
                    secondaryAction={
                      <IconButton
                        size="small"
                        title="Acknowledge"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAck(evt.id);
                        }}
                      >
                        <CheckCircleIcon fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemButton
                      onClick={() => {
                        setAnchorEl(null);
                        navigate('/admin/system');
                      }}
                      sx={{ py: 1, pr: 6 }}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        {evt.status === 'failed' ? (
                          <ErrorOutlineIcon color="error" fontSize="small" />
                        ) : (
                          <WarningAmberIcon
                            sx={{ color: 'warning.main' }}
                            fontSize="small"
                          />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {errorSummary}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" color="text.secondary">
                            {evt.status === 'partial' ? 'Partial' : 'Failed'}
                            {' \u00b7 '}
                            {formatRelative(evt.started_at)}
                            {evt.readings_synced > 0 &&
                              ` \u00b7 ${evt.readings_synced} readings`}
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </Popover>
    </Box>
  );
};
