import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Title, useGetList } from 'react-admin';
import {
  Autocomplete,
  Box,
  Paper,
  TextField,
  Typography,
  Breadcrumbs,
  Chip,
  IconButton,
  Collapse,
  Card,
  CardContent,
  Grid2 as Grid,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FilterListIcon from '@mui/icons-material/FilterList';
import LocationOffIcon from '@mui/icons-material/LocationOff';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import HistoryToggleOffIcon from '@mui/icons-material/HistoryToggleOff';
import { SiteMap } from './components/dashboard/SiteMap';
import ChartsDashboard from './components/dashboard/ChartsDashboard';
import type { ChartsDashboardRef } from './components/dashboard/ChartsDashboard';
import { useRiverDataProvider } from './useRiverDataProvider';

interface SiteOption {
  id: string;
  name: string;
  project_id: string;
  hasCoords: boolean;
}

interface SummaryCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
}

const SummaryCard = ({ label, value, icon, color }: SummaryCardProps) => (
  <Card variant="outlined">
    <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{ color, display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Box>
        <Typography variant="h5" fontWeight={600} sx={{ lineHeight: 1.1 }}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Box>
    </CardContent>
  </Card>
);

const AlarmSummaryRow = () => {
  const dataProvider = useRiverDataProvider();
  const [summary, setSummary] = useState<{ total: number; warning: number; alarm: number; siteCount: number }>({
    total: 0,
    warning: 0,
    alarm: 0,
    siteCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const fetchSummary = async () => {
      try {
        const { data } = await dataProvider.getAlarmSummary();
        if (cancelled) return;
        setSummary({
          total: data.total,
          warning: data.by_severity.warning,
          alarm: data.by_severity.alarm,
          siteCount: data.by_site.length,
        });
      } catch {
        // silent — the AppBar bell handles errors
      }
    };
    fetchSummary();
    const interval = setInterval(fetchSummary, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dataProvider]);

  return (
    <Grid container spacing={2} sx={{ mt: 3, mb: 2 }}>
      <Grid size={{ xs: 12, sm: 4 }}>
        <SummaryCard
          label="Active alarms"
          value={summary.alarm + summary.warning}
          icon={<NotificationsActiveIcon />}
          color={summary.alarm > 0 ? 'error.main' : summary.warning > 0 ? 'warning.main' : 'success.main'}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <SummaryCard
          label="Critical (alarm tier)"
          value={summary.alarm}
          icon={<HealthAndSafetyIcon />}
          color={summary.alarm > 0 ? 'error.main' : 'success.main'}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <SummaryCard
          label="Sites with alarms"
          value={summary.siteCount}
          icon={<HistoryToggleOffIcon />}
          color={summary.siteCount > 0 ? 'warning.main' : 'success.main'}
        />
      </Grid>
    </Grid>
  );
};

const Dashboard = () => {
  const chartsRef = useRef<ChartsDashboardRef>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedSiteName, setSelectedSiteName] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(true);
  const [mapProjectFilter, setMapProjectFilter] = useState<string | null>(null);
  const [missingCoordCount, setMissingCoordCount] = useState(0);

  const { data: projects } = useGetList('projects', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'name', order: 'ASC' },
  });

  // Fetch sites filtered by the selected project (server-side filter)
  const { data: filteredSites } = useGetList<{
    id: string; name: string; project_id: string;
    latitude: number | null; longitude: number | null;
  }>('sites', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
    ...(mapProjectFilter ? { filter: { project_id: mapProjectFilter } } : {}),
  });

  const projectName = useMemo(() => {
    if (!selectedProjectId || !projects) return null;
    return projects.find((p) => p.id === selectedProjectId)?.name ?? null;
  }, [selectedProjectId, projects]);

  const siteOptions: SiteOption[] = useMemo(() => {
    if (!filteredSites) return [];
    return filteredSites.map((s) => ({
      id: s.id,
      name: s.name,
      project_id: s.project_id,
      hasCoords: s.latitude != null && s.longitude != null,
    })).sort((a, b) => {
      // Sites without coordinates first, then alphabetical
      if (a.hasCoords !== b.hasCoords) return a.hasCoords ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredSites]);

  const handleSiteClick = useCallback(
    (siteId: string, site: { name: string; project_id: string }) => {
      setSelectedSiteId(siteId);
      setSelectedSiteName(site.name);
      setSelectedProjectId(site.project_id);
      chartsRef.current?.selectSite(siteId);
    },
    [],
  );

  return (
    <>
      <Title title={selectedSiteName ? `${selectedSiteName} – River Data` : 'River Data Admin'} />

      {/* Alarm summary cards */}
      <AlarmSummaryRow />

      {/* Info bar — only shown when a site is selected */}
      {selectedSiteId && (
        <Paper
          elevation={0}
          sx={{
            px: 2,
            py: 1,
            mb: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Breadcrumbs separator="›">
            {projectName && (
              <Chip label={projectName} color="primary" variant="outlined" />
            )}
            <Typography variant="h6" fontWeight={600}>
              {selectedSiteName}
            </Typography>
          </Breadcrumbs>
          <IconButton
            onClick={() => setMapExpanded((prev) => !prev)}
            title={mapExpanded ? 'Collapse map' : 'Show map'}
          >
            {mapExpanded ? <ExpandLessIcon /> : <MapIcon />}
          </IconButton>
        </Paper>
      )}

      {/* Collapsible full-width map */}
      <Collapse in={mapExpanded}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, flexWrap: 'wrap' }}>
          {projects && projects.length > 1 && (
            <>
              <FilterListIcon sx={{ fontSize: '1rem', color: 'text.secondary' }} />
              <Chip
                label="All"
                variant={mapProjectFilter === null ? 'filled' : 'outlined'}
                color={mapProjectFilter === null ? 'primary' : 'default'}
                onClick={() => setMapProjectFilter(null)}
              />
              {projects.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  variant={mapProjectFilter === p.id ? 'filled' : 'outlined'}
                  color={mapProjectFilter === p.id ? 'primary' : 'default'}
                  onClick={() => setMapProjectFilter(mapProjectFilter === p.id ? null : p.id)}
                />
              ))}
            </>
          )}
          <Autocomplete
            options={siteOptions}
            getOptionLabel={(option) => option.name}
            groupBy={(option) => option.hasCoords ? 'On map' : 'No coordinates'}
            value={siteOptions.find((s) => s.id === selectedSiteId) || null}
            onChange={(_, value) => {
              if (value) {
                handleSiteClick(value.id, { name: value.name, project_id: value.project_id });
              } else {
                setSelectedSiteId(null);
                setSelectedSiteName(null);
                setSelectedProjectId(null);
                chartsRef.current?.clearSite();
              }
            }}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {!option.hasCoords && (
                    <LocationOffIcon sx={{ fontSize: '0.875rem', color: 'warning.main' }} />
                  )}
                  <Typography variant="body2">{option.name}</Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={missingCoordCount > 0
                  ? `Search sites (${missingCoordCount} without coords)...`
                  : 'Search sites...'}
                variant="outlined"
                sx={{ '& .MuiInputBase-root': { height: 32, py: 0 } }}
              />
            )}
            sx={{ ml: 'auto', minWidth: 240 }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
          />
        </Box>
        <Box sx={{ height: 300, borderRadius: 1, overflow: 'hidden' }}>
          <SiteMap
            onSiteClick={handleSiteClick}
            selectedSiteId={selectedSiteId}
            onMissingCount={setMissingCoordCount}
            filterProjectId={mapProjectFilter}
          />
        </Box>
      </Collapse>

      {/* Charts engine (site buttons hidden — map is the picker) */}
      <Box sx={{ minWidth: 0, mt: 2 }}>
        <ChartsDashboard ref={chartsRef} hideHeader skipAutoLoad />
      </Box>
    </>
  );
};

export default Dashboard;
