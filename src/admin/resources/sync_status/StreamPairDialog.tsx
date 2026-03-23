import { useState, useEffect } from 'react';
import { useNotify } from 'react-admin';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip,
  TextField,
  CircularProgress,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { StreamState, ApplyAction } from '../../dataProvider';

interface Entity {
  id: string;
  name: string;
}

interface StreamPairDialogProps {
  open: boolean;
  stream: StreamState | null;
  onClose: () => void;
  onPaired: () => void;
}

function parseStreamHierarchy(stream: StreamState) {
  const parts = (stream.source_path ?? '').split('/').filter(Boolean);
  // Expected: ["viewLinc", "PROJECT", "SITE", "PARAM"] — skip system prefix
  const hierarchy =
    parts.length > 1 && parts[0].toLowerCase() === 'viewlinc'
      ? parts.slice(1)
      : parts;

  return {
    projectName: hierarchy[0] ?? '',
    siteName: hierarchy[1] ?? '',
    paramName: hierarchy[2] ?? stream.source_name ?? '',
  };
}

function findMatch(entities: Entity[], name: string): Entity | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  return entities.find((e) => e.name.toLowerCase() === lower) ?? null;
}

export const StreamPairDialog = ({ open, stream, onClose, onPaired }: StreamPairDialogProps) => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [projects, setProjects] = useState<Entity[]>([]);
  const [sites, setSites] = useState<Entity[]>([]);
  const [parameters, setParameters] = useState<Entity[]>([]);

  // Editable fields
  const [projectName, setProjectName] = useState('');
  const [siteName, setSiteName] = useState('');
  const [paramName, setParamName] = useState('');
  const [units, setUnits] = useState('');

  // Load existing entities and pre-fill from stream metadata
  useEffect(() => {
    if (!open || !stream) return;

    const parsed = parseStreamHierarchy(stream);
    setProjectName(parsed.projectName);
    setSiteName(parsed.siteName);
    setParamName(parsed.paramName);
    setUnits(
      typeof stream.metadata?.units === 'string' ? stream.metadata.units : '',
    );

    setLoading(true);
    Promise.all([
      dataProvider.getList('projects', {
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'name', order: 'ASC' },
        filter: {},
      }),
      dataProvider.getList('sites', {
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'name', order: 'ASC' },
        filter: {},
      }),
      dataProvider.getList('parameters', {
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'name', order: 'ASC' },
        filter: {},
      }),
    ])
      .then(([projRes, siteRes, paramRes]) => {
        setProjects(projRes.data as Entity[]);
        setSites(siteRes.data as Entity[]);
        setParameters(paramRes.data as Entity[]);
      })
      .catch(() => notify('Failed to load entities', { type: 'error' }))
      .finally(() => setLoading(false));
  }, [open, stream, dataProvider, notify]);

  const projectMatch = findMatch(projects, projectName);
  const siteMatch = findMatch(sites, siteName);
  const paramMatch = findMatch(parameters, paramName);

  const canApply = projectName.trim() && siteName.trim() && paramName.trim();

  const handleApply = async () => {
    if (!stream || !canApply) return;
    setApplying(true);

    const metadata = stream.metadata ?? {};
    const action: ApplyAction = {
      stream_id: stream.id,
      pair_to: 'new',
      use_project_id: projectMatch?.id ?? undefined,
      use_site_id: siteMatch?.id ?? undefined,
      use_parameter_id: paramMatch?.id ?? undefined,
    };

    if (!projectMatch) {
      action.create_project = { name: projectName.trim() };
    }
    if (!siteMatch) {
      action.create_site = { name: siteName.trim() };
    }
    if (!paramMatch) {
      action.create_parameter = {
        name: paramName.trim(),
        display_name: paramName.trim(),
        default_units: units,
        category: 'measurement',
      };
    }
    action.create_site_parameter = {
      display_units: units || undefined,
      sample_interval_sec:
        typeof metadata.sample_interval_sec === 'number'
          ? metadata.sample_interval_sec
          : undefined,
      channel_id:
        typeof metadata.channel_id === 'number'
          ? metadata.channel_id
          : undefined,
    };

    try {
      const res = await dataProvider.applyDiscovery([action]);
      if (res.data.errors.length > 0) {
        notify(res.data.errors[0], { type: 'error' });
      } else {
        notify('Stream paired successfully', { type: 'success' });
        onPaired();
        onClose();
      }
    } catch {
      notify('Failed to pair stream', { type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  const statusChip = (match: Entity | null, name: string) => {
    if (!name.trim()) return null;
    return match ? (
      <Chip label="exists" color="success" size="small" variant="outlined" />
    ) : (
      <Chip label="will create" color="warning" size="small" variant="outlined" />
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinkIcon color="primary" />
        Quick Pair
      </DialogTitle>
      <DialogContent>
        {stream && (
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {stream.source_name} — {stream.source_path}
          </Typography>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap={2} mt={2}>
            <Box display="flex" alignItems="center" gap={1}>
              <TextField
                label="Project"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                size="small"
                fullWidth
              />
              {statusChip(projectMatch, projectName)}
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <TextField
                label="Site"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                size="small"
                fullWidth
              />
              {statusChip(siteMatch, siteName)}
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <TextField
                label="Parameter"
                value={paramName}
                onChange={(e) => setParamName(e.target.value)}
                size="small"
                fullWidth
              />
              {statusChip(paramMatch, paramName)}
            </Box>
            <TextField
              label="Units"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              size="small"
              fullWidth
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleApply}
          variant="contained"
          disabled={!canApply || applying || loading}
          startIcon={applying ? <CircularProgress size={16} /> : <LinkIcon />}
        >
          {applying ? 'Creating & Pairing...' : 'Create & Pair'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
