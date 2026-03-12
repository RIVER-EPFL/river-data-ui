import { useEffect, useState, useCallback } from 'react';
import { useGetList } from 'react-admin';
import { Box, Card, CardContent, Typography } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import MemoryIcon from '@mui/icons-material/Memory';
import ScienceIcon from '@mui/icons-material/Science';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SignalWifiOffIcon from '@mui/icons-material/SignalWifiOff';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SyncIcon from '@mui/icons-material/Sync';
import { useRiverDataProvider } from '../../useRiverDataProvider';

interface SyncState {
  site_parameter_id: string;
  last_data_time: string | null;
  last_sync_attempt: string | null;
  sync_status: string | null;
  error_message: string | null;
}

interface SiteParameterRecord {
  id: string;
  site_id: string;
}

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

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

  const { data: siteParameters } = useGetList<SiteParameterRecord>(
    'site_parameters',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
    },
  );

  const [alarmTotal, setAlarmTotal] = useState(0);
  const [alarmSubtitle, setAlarmSubtitle] = useState('');
  const [staleSiteCount, setStaleSiteCount] = useState(0);
  const [healthIssueCount, setHealthIssueCount] = useState(0);
  const [syncLabel, setSyncLabel] = useState<string>('...');

  const computeSyncMetrics = useCallback(
    (states: SyncState[]) => {
      if (!siteParameters || siteParameters.length === 0) return;

      // Map site_parameter_id -> site_id
      const spToSite = new Map<string, string>();
      for (const sp of siteParameters) {
        spToSite.set(sp.id, sp.site_id);
      }

      // Group by site: find max last_data_time per site
      const siteLastData = new Map<string, number>();
      let errorCount = 0;

      for (const s of states) {
        if (s.sync_status === 'error') errorCount++;

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
      setHealthIssueCount(errorCount);
    },
    [siteParameters],
  );

  useEffect(() => {
    // Fetch alarm summary
    dataProvider
      .getAlarmSummary()
      .then(({ data }) => {
        setAlarmTotal(data.total);
        const parts: string[] = [];
        if (data.by_severity.alarm > 0)
          parts.push(`${data.by_severity.alarm} alarm`);
        if (data.by_severity.warning > 0)
          parts.push(`${data.by_severity.warning} warning`);
        setAlarmSubtitle(parts.join(', '));
      })
      .catch(() => {
        setAlarmTotal(0);
        setAlarmSubtitle('');
      });

    // Fetch sync state for stale sites, health issues, and last sync label
    dataProvider
      .getSyncState()
      .then((res: { data: unknown }) => {
        const states = res.data as SyncState[];
        if (!Array.isArray(states) || states.length === 0) {
          setSyncLabel('No data');
          return;
        }

        computeSyncMetrics(states);

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
  }, [dataProvider, computeSyncMetrics]);

  const cards = [
    {
      label: 'Sites',
      value: siteCount ?? 0,
      icon: <LocationOnIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
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
      label: 'Active Alarms',
      value: alarmTotal,
      subtitle: alarmSubtitle,
      icon: (
        <WarningAmberIcon
          sx={{ fontSize: 40, color: alarmTotal > 0 ? 'error.main' : 'success.main' }}
        />
      ),
    },
    {
      label: 'Stale Sites',
      value: staleSiteCount,
      subtitle: staleSiteCount > 0 ? 'No data >1h' : 'All current',
      icon: (
        <SignalWifiOffIcon
          sx={{ fontSize: 40, color: staleSiteCount > 0 ? 'warning.main' : 'success.main' }}
        />
      ),
    },
    {
      label: 'Sync Errors',
      value: healthIssueCount,
      icon: (
        <ReportProblemIcon
          sx={{ fontSize: 40, color: healthIssueCount > 0 ? 'error.main' : 'success.main' }}
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
        <Card key={card.label} sx={{ flex: '1 1 160px', minWidth: 160 }}>
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
              {'subtitle' in card && card.subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {card.subtitle}
                </Typography>
              )}
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};
