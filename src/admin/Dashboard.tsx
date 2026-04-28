import { useRef, useState, useMemo, useCallback } from 'react';
import { Title, useGetList } from 'react-admin';
import {
  Box,
  Paper,
  Typography,
  Breadcrumbs,
  Chip,
  IconButton,
  Collapse,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { SiteMap } from './components/dashboard/SiteMap';
import ChartsDashboard from './components/dashboard/ChartsDashboard';
import type { ChartsDashboardRef } from './components/dashboard/ChartsDashboard';

const Dashboard = () => {
  const chartsRef = useRef<ChartsDashboardRef>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedSiteName, setSelectedSiteName] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(true);
  const [missingCoordCount, setMissingCoordCount] = useState(0);

  const { data: projects } = useGetList('projects', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'name', order: 'ASC' },
  });

  const projectName = useMemo(() => {
    if (!selectedProjectId || !projects) return null;
    return projects.find((p) => p.id === selectedProjectId)?.name ?? null;
  }, [selectedProjectId, projects]);

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

      {/* Info bar */}
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
        {selectedSiteId ? (
          <Breadcrumbs separator="›">
            {projectName && (
              <Chip label={projectName} size="small" color="primary" variant="outlined" />
            )}
            <Typography variant="h6" fontWeight={600}>
              {selectedSiteName}
            </Typography>
          </Breadcrumbs>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Select a site on the map to view data
          </Typography>
        )}
        <IconButton
          size="small"
          onClick={() => setMapExpanded((prev) => !prev)}
          title={mapExpanded ? 'Collapse map' : 'Show map'}
        >
          {mapExpanded ? <ExpandLessIcon /> : <MapIcon />}
        </IconButton>
      </Paper>

      {/* Collapsible full-width map */}
      <Collapse in={mapExpanded}>
        <Box sx={{ height: 300, borderRadius: 1, overflow: 'hidden' }}>
          <SiteMap
            onSiteClick={handleSiteClick}
            selectedSiteId={selectedSiteId}
            onMissingCount={setMissingCoordCount}
          />
        </Box>
        {missingCoordCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', px: 1, py: 0.25 }}>
            {missingCoordCount} sites without coordinates
          </Typography>
        )}
      </Collapse>

      {/* Charts engine (site buttons hidden — map is the picker) */}
      <Box sx={{ minWidth: 0 }}>
        <ChartsDashboard ref={chartsRef} hideHeader skipAutoLoad />
      </Box>
    </>
  );
};

export default Dashboard;
