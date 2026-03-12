import { useState, useEffect, useCallback } from 'react';
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
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import { useNavigate } from 'react-router';
import { useRiverDataProvider } from '../useRiverDataProvider';
import type { ActiveAlarm } from '../dataProvider';

interface AlarmNotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

const REFRESH_INTERVAL = 60_000;

export const AlarmNotificationPanel = ({ open, onClose }: AlarmNotificationPanelProps) => {
  const dataProvider = useRiverDataProvider();
  const navigate = useNavigate();
  const [alarms, setAlarms] = useState<ActiveAlarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleAlarmClick = (alarm: ActiveAlarm) => {
    onClose();
    navigate(`/admin/sites/${alarm.site_id}/show`);
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 380 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2 }}>
          <Typography variant="h6">Active Alarms</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
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

        {!loading && !error && alarms.length === 0 && (
          <Typography sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
            No active alarms
          </Typography>
        )}

        {!loading && !error && alarms.length > 0 && (
          <List disablePadding>
            {alarms.map((alarm, i) => (
              <ListItem key={`${alarm.site_id}-${alarm.parameter_id}`} disablePadding divider={i < alarms.length - 1}>
                <ListItemButton onClick={() => handleAlarmClick(alarm)} sx={{ py: 1.5 }}>
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
        )}
      </Box>
    </Drawer>
  );
};
