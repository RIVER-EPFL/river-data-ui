import { useState, useEffect, useCallback } from 'react';
import {
  List,
  Datagrid,
  TextField,
  DateField,
  BooleanField,
  Show,
  TabbedShowLayout,
  Edit,
  TabbedForm,
  TextInput,
  BooleanInput,
  ReferenceManyField,
  ReferenceField,
  NumberField,
  TopToolbar,
  EditButton,
  useRecordContext,
  useNotify,
  useRefresh,
  useGetList,
} from 'react-admin';
import {
  Button,
  Box,
  Typography,
  Chip,
  Tooltip,
  CircularProgress,
  Alert,
  IconButton,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CachedIcon from '@mui/icons-material/Cached';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { Link } from 'react-router-dom';
import { useRiverDataProvider } from '../../useRiverDataProvider';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const PublicApiActions = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  if (!record) return null;

  if (!record.is_public || !record.public_slug) {
    return (
      <Box sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Enable public API access in Edit mode to configure this section.
        </Typography>
      </Box>
    );
  }

  const handleInvalidate = async () => {
    try {
      await dataProvider.invalidatePublicConfig(record.public_slug as string);
      notify('Public config cache invalidated', { type: 'success' });
      refresh();
    } catch {
      notify('Cache invalidation failed', { type: 'error' });
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
      <Button
        variant="outlined"
        size="small"
        startIcon={<CachedIcon />}
        onClick={handleInvalidate}
      >
        Invalidate Cache
      </Button>
      <Button
        variant="outlined"
        size="small"
        startIcon={<OpenInNewIcon />}
        href={`/api/public/${record.public_slug}/docs`}
        target="_blank"
        rel="noopener"
      >
        View Public API Docs
      </Button>
    </Box>
  );
};

const AddExposedParameterButton = () => {
  const record = useRecordContext();
  if (!record) return null;

  return (
    <Button
      component={Link}
      to={`/public_exposed_parameters/create?source=${encodeURIComponent(JSON.stringify({ project_id: record.id }))}`}
      size="small"
      startIcon={<AddIcon />}
    >
      Add Exposed Parameter
    </Button>
  );
};

/** Preview of what the public API returns */
const PREVIEW_MAX_ITEMS = 3;

const PublicApiPreview = () => {
  const record = useRecordContext();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchPreview = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/${slug}/sites`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch preview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (record?.is_public && record?.public_slug) {
      fetchPreview(record.public_slug as string);
    }
  }, [record?.id, record?.is_public, record?.public_slug, fetchPreview]);

  if (!record?.is_public || !record?.public_slug) return null;

  const truncated = Array.isArray(data) && data.length > PREVIEW_MAX_ITEMS;
  const displayData = truncated && !expanded ? data.slice(0, PREVIEW_MAX_ITEMS) : data;

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1">API Response Preview</Typography>
        <Tooltip title="Refresh preview">
          <IconButton
            size="small"
            onClick={() => fetchPreview(record.public_slug as string)}
            disabled={loading}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        GET /api/public/{record.public_slug as string}/sites
      </Typography>
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Loading preview...</Typography>
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {!loading && !error && data !== null && (
        <>
          <Box
            component="pre"
            sx={{
              bgcolor: 'grey.900',
              color: 'grey.100',
              p: 2,
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 400,
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              m: 0,
            }}
          >
            {JSON.stringify(displayData, null, 2)}
          </Box>
          {truncated && (
            <Button
              size="small"
              onClick={() => setExpanded(!expanded)}
              startIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ mt: 0.5 }}
            >
              {expanded
                ? 'Show less'
                : `Show all ${(data as unknown[]).length} items (${(data as unknown[]).length - PREVIEW_MAX_ITEMS} more)`}
            </Button>
          )}
        </>
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const ProjectSiteCount = (_props: { label?: string }) => {
  const record = useRecordContext();
  const { total } = useGetList('sites', {
    filter: record ? { project_id: record.id } : {},
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'name', order: 'ASC' },
  }, { enabled: !!record });

  if (total === undefined) return null;
  return <Chip label={`${total} site${total !== 1 ? 's' : ''}`} size="small" variant="outlined" />;
};

const PublicApiUrl = () => {
  const record = useRecordContext();
  const notify = useNotify();
  if (!record?.is_public || !record?.public_slug) return null;

  const url = `${window.location.origin}/api/public/${record.public_slug}`;
  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      notify('URL copied to clipboard', { type: 'info' });
    });
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', px: 1, py: 0.5, borderRadius: 1 }}>
        {url}
      </Typography>
      <Tooltip title="Copy URL">
        <Button size="small" onClick={handleCopy} startIcon={<ContentCopyIcon />}>
          Copy
        </Button>
      </Tooltip>
    </Box>
  );
};

const ProjectList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <TextField source="data_source" />
      <TextField source="description" />
      <ProjectSiteCount label="Sites" />
      <BooleanField source="is_public" label="Public" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

const ProjectShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <TabbedShowLayout>
      <TabbedShowLayout.Tab label="Overview">
        <TextField source="id" />
        <TextField source="name" />
        <TextField source="data_source" />
        <TextField source="description" />
        <DateField source="created_at" showTime />
        <DateField source="discovered_at" showTime />
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Public API">
        <BooleanField source="is_public" />
        <TextField source="public_slug" emptyText="Not configured" />
        <TextField source="public_api_title" label="API Title" emptyText="Not configured" />
        <TextField source="public_api_description" label="API Description" emptyText="Not configured" />
        <TextField source="public_api_version" label="API Version" emptyText="Not configured" />
        <TextField source="public_contact_email" label="Contact Email" emptyText="Not configured" />
        <PublicApiUrl />
        <PublicApiActions />
        <PublicApiPreview />
        <Typography variant="subtitle1" sx={{ mt: 2, mb: 1 }}>Exposed Parameters</Typography>
        <ReferenceManyField reference="public_exposed_parameters" target="project_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="edit">
            <TextField source="public_name" label="Name" />
            <TextField source="public_units" label="Units" />
            <ReferenceField source="parameter_type_id" reference="parameters" link={false}>
              <TextField source="display_name" />
            </ReferenceField>
            <TextField source="description" />
            <NumberField source="sort_order" />
            <BooleanField source="include_derived" />
          </Datagrid>
        </ReferenceManyField>
        <AddExposedParameterButton />
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  </Show>
);

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const ProjectEdit = () => {
  const notify = useNotify();
  const dataProvider = useRiverDataProvider();

  return (
    <Edit
      mutationOptions={{
        onSuccess: (data: Record<string, unknown>) => {
          notify('Project saved', { type: 'success' });
          if (data.public_slug) {
            dataProvider.invalidatePublicConfig(data.public_slug as string).catch(() => {
              // Cache invalidation is best-effort
            });
          }
        },
      }}
      mutationMode="pessimistic"
    >
      <TabbedForm>
        <TabbedForm.Tab label="Overview">
          <TextInput source="name" />
          <TextInput source="data_source" />
          <TextInput source="description" multiline />
        </TabbedForm.Tab>
        <TabbedForm.Tab label="Public API">
          <BooleanInput source="is_public" />
          <TextInput source="public_slug" helperText="URL-safe slug, e.g. 'mountresilience'. Used in /api/public/{slug}/..." />
          <TextInput source="public_api_title" helperText="Title shown in API docs" />
          <TextInput source="public_api_description" multiline helperText="Description shown in API docs" />
          <TextInput source="public_api_version" helperText="e.g. 1.0.0" />
          <TextInput source="public_contact_email" type="email" helperText="Contact email for API documentation" />
        </TabbedForm.Tab>
      </TabbedForm>
    </Edit>
  );
};

export default {
  list: ProjectList,
  show: ProjectShow,
  edit: ProjectEdit,
};
