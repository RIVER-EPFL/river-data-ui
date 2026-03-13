import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Chip,
  Typography,
  Box,
  Divider,
  IconButton,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Tabs,
  Tab,
  Button,
  Menu,
  MenuItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SnoozeIcon from '@mui/icons-material/Snooze';
import { useNavigate } from 'react-router';
import { useRiverDataProvider } from '../useRiverDataProvider';
import type { ActiveAlarm } from '../dataProvider';

interface AlarmNotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

const REFRESH_INTERVAL = 60_000;
const ACK_STORAGE_KEY = 'river-data-alarm-ack';

type SeverityFilter = 'all' | 'warning' | 'alarm';

interface AckEntry {
  key: string;
  until: number; // epoch ms — 0 means permanent ack
}

function loadAcks(): AckEntry[] {
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY);
    if (!raw) return [];
    const entries: AckEntry[] = JSON.parse(raw);
    const now = Date.now();
    return entries.filter((e) => e.until === 0 || e.until > now);
  } catch {
    return [];
  }
}

function saveAcks(acks: AckEntry[]) {
  localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(acks));
}

function alarmKey(alarm: ActiveAlarm): string {
  return `${alarm.site_id}:${alarm.parameter_id}`;
}

export const AlarmNotificationPanel = ({ open, onClose }: AlarmNotificationPanelProps) => {
  const dataProvider = useRiverDataProvider();
  const navigate = useNavigate();
  const [alarms, setAlarms] = useState<ActiveAlarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [tab, setTab] = useState(0); // 0 = active, 1 = acknowledged
  const [acks, setAcks] = useState<AckEntry[]>(loadAcks);
  const [snoozeAnchor, setSnoozeAnchor] = useState<null | HTMLElement>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<ActiveAlarm | null>(null);

  const fetchAlarms = useCallback(async () => {
    try {
      const { data } = await dataProvider.getActiveAlarms();
      setAlarms(data.alarms);
      setError(null);
    } catch {
      setError('Failed to load alarms');
    } finally {
      setLoading(false);
    }
  }, [dataProvider]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAlarms();
    const interval = setInterval(fetchAlarms, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [open, fetchAlarms]);

  const ackedKeys = useMemo(() => new Set(acks.map((a) => a.key)), [acks]);

  const filtered = useMemo(() => {
    let list = alarms;
    if (severityFilter === 'warning') list = list.filter((a) => a.severity === 1);
    if (severityFilter === 'alarm') list = list.filter((a) => a.severity === 2);
    return list;
  }, [alarms, severityFilter]);

  const activeAlarms = useMemo(() => filtered.filter((a) => !ackedKeys.has(alarmKey(a))), [filtered, ackedKeys]);
  const ackedAlarms = useMemo(() => filtered.filter((a) => ackedKeys.has(alarmKey(a))), [filtered, ackedKeys]);

  const handleAlarmClick = (alarm: ActiveAlarm) => {
    onClose();
    navigate(`/admin/sites/${alarm.site_id}/show`);
  };

  const handleAcknowledge = (alarm: ActiveAlarm) => {
    const entry: AckEntry = { key: alarmKey(alarm), until: 0 };
    const next = [...acks.filter((a) => a.key !== entry.key), entry];
    setAcks(next);
    saveAcks(next);
  };

  const handleSnooze = (alarm: ActiveAlarm, hours: number) => {
    const entry: AckEntry = { key: alarmKey(alarm), until: Date.now() + hours * 3600_000 };
    const next = [...acks.filter((a) => a.key !== entry.key), entry];
    setAcks(next);
    saveAcks(next);
    setSnoozeAnchor(null);
    setSnoozeTarget(null);
  };

  const handleUnack = (alarm: ActiveAlarm) => {
    const next = acks.filter((a) => a.key !== alarmKey(alarm));
    setAcks(next);
    saveAcks(next);
  };

  const renderAlarmList = (list: ActiveAlarm[], showUnack: boolean) => (
    <List disablePadding>
      {list.map((alarm, i) => (
        <ListItem
          key={alarmKey(alarm)}
          disablePadding
          divider={i < list.length - 1}
          secondaryAction={
            !showUnack ? (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                  title="Acknowledge"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAcknowledge(alarm);
                  }}
                >
                  <CheckCircleIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  title="Snooze"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSnoozeTarget(alarm);
                    setSnoozeAnchor(e.currentTarget);
                  }}
                >
                  <SnoozeIcon fontSize="small" />
                </IconButton>
              </Box>
            ) : (
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnack(alarm);
                }}
              >
                Unack
              </Button>
            )
          }
        >
          <ListItemButton onClick={() => handleAlarmClick(alarm)} sx={{ py: 1.5, pr: 10 }}>
            <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center' }}>
              {alarm.severity === 2 ? (
                <ErrorIcon color="error" fontSize="small" />
              ) : (
                <WarningAmberIcon sx={{ color: 'warning.main' }} fontSize="small" />
              )}
            </Box>
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {alarm.site_name}
                  </Typography>
                  <Chip
                    label={alarm.severity === 2 ? 'ALARM' : 'WARNING'}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      bgcolor: alarm.severity === 2 ? 'error.main' : 'warning.main',
                      color: 'white',
                    }}
                  />
                </Box>
              }
              secondary={
                <Typography variant="caption" color="text.secondary" component="span">
                  {alarm.parameter_name}: {alarm.current_value.toFixed(2)}
                </Typography>
              }
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  );

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 420 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
          <Typography variant="h6">
            Alarms {activeAlarms.length > 0 ? `(${activeAlarms.length})` : ''}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        <Box sx={{ px: 2, pb: 1 }}>
          <ToggleButtonGroup
            value={severityFilter}
            exclusive
            onChange={(_, v) => v && setSeverityFilter(v)}
            size="small"
            fullWidth
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="warning">Warning</ToggleButton>
            <ToggleButton value="alarm">Alarm</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2 }}>
          <Tab label={`Active (${activeAlarms.length})`} />
          <Tab label={`Acknowledged (${ackedAlarms.length})`} />
        </Tabs>
        <Divider />

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {error && (
          <Typography color="error" sx={{ p: 2, textAlign: 'center' }}>
            {error}
          </Typography>
        )}

        {!loading && !error && tab === 0 && activeAlarms.length === 0 && (
          <Typography sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            No active alarms
          </Typography>
        )}

        {!loading && !error && tab === 0 && activeAlarms.length > 0 && renderAlarmList(activeAlarms, false)}

        {!loading && !error && tab === 1 && ackedAlarms.length === 0 && (
          <Typography sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            No acknowledged alarms
          </Typography>
        )}

        {!loading && !error && tab === 1 && ackedAlarms.length > 0 && renderAlarmList(ackedAlarms, true)}

        <Menu
          anchorEl={snoozeAnchor}
          open={Boolean(snoozeAnchor)}
          onClose={() => { setSnoozeAnchor(null); setSnoozeTarget(null); }}
        >
          {[1, 4, 24].map((h) => (
            <MenuItem
              key={h}
              onClick={() => snoozeTarget && handleSnooze(snoozeTarget, h)}
            >
              Snooze {h}h
            </MenuItem>
          ))}
        </Menu>
      </Box>
    </Drawer>
  );
};

/** Return the number of un-acknowledged active alarms (for badge count). */
export function useUnackedAlarmCount(alarms: ActiveAlarm[]): number {
  const acked = useMemo(() => new Set(loadAcks().map((a) => a.key)), []);
  return alarms.filter((a) => !acked.has(alarmKey(a))).length;
}
