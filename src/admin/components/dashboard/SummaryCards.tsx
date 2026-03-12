import { useEffect, useState } from 'react';
import { useGetList } from 'react-admin';
import { Box, Card, CardContent, Typography } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import MemoryIcon from '@mui/icons-material/Memory';
import ScienceIcon from '@mui/icons-material/Science';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SyncIcon from '@mui/icons-material/Sync';
import { useRiverDataProvider } from '../../useRiverDataProvider';

interface SyncState {
  last_sync_attempt: string | null;
  sync_status: string | null;
}

export const SummaryCards = () => {
  const dataProvider = useRiverDataProvider();

  const { total: siteCount } = useGetList('sites', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { total: sensorCount } = useGetList('sensors', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'name', order: 'ASC' },
    filter: { is_active: true },
  });

  const { total: paramCount } = useGetList('parameters', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { total: alarmRuleCount } = useGetList('alarm_thresholds', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
  });

  const [syncLabel, setSyncLabel] = useState<string>('...');

  useEffect(() => {
    dataProvider
      .getSyncState()
      .then((res: { data: unknown }) => {
        const states = res.data as SyncState[];
        if (!Array.isArray(states) || states.length === 0) {
          setSyncLabel('No data');
          return;
        }
        // Find the most recent sync attempt
        const latest = states
          .filter((s) => s.last_sync_attempt != null)
          .sort(
            (a, b) =>
              new Date(b.last_sync_attempt!).getTime() -
              new Date(a.last_sync_attempt!).getTime(),
          )[0];
        if (!latest?.last_sync_attempt) {
          setSyncLabel('Never');
          return;
        }
        const d = new Date(latest.last_sync_attempt);
        setSyncLabel(
          d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        );
      })
      .catch(() => {
        setSyncLabel('N/A');
      });
  }, [dataProvider]);

  const cards = [
    {
      label: 'Sites',
      value: siteCount ?? 0,
      icon: (
        <LocationOnIcon sx={{ fontSize: 40, color: 'primary.main' }} />
      ),
    },
    {
      label: 'Active Sensors',
      value: sensorCount ?? 0,
      icon: <MemoryIcon sx={{ fontSize: 40, color: 'info.main' }} />,
    },
    {
      label: 'Parameters',
      value: paramCount ?? 0,
      icon: <ScienceIcon sx={{ fontSize: 40, color: 'success.main' }} />,
    },
    {
      label: 'Alarm Rules',
      value: alarmRuleCount ?? 0,
      icon: (
        <NotificationsActiveIcon
          sx={{ fontSize: 40, color: 'warning.main' }}
        />
      ),
    },
    {
      label: 'Last Sync',
      value: syncLabel,
      icon: <SyncIcon sx={{ fontSize: 40, color: 'secondary.main' }} />,
      small: true,
    },
  ];

  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
      {cards.map((card) => (
        <Card key={card.label} sx={{ flex: '1 1 200px', minWidth: 200 }}>
          <CardContent
            sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            {card.icon}
            <Box>
              <Typography
                variant={'small' in card && card.small ? 'h6' : 'h4'}
                fontWeight="bold"
              >
                {card.value}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {card.label}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};
