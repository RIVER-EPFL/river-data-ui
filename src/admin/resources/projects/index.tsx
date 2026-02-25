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
} from 'react-admin';
import { Button, Box, Typography } from '@mui/material';
import CachedIcon from '@mui/icons-material/Cached';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddIcon from '@mui/icons-material/Add';
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

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const ProjectList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <TextField source="data_source" />
      <TextField source="description" />
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
        <PublicApiActions />
        <Typography variant="subtitle1" sx={{ mt: 2, mb: 1 }}>Exposed Parameters</Typography>
        <ReferenceManyField reference="public_exposed_parameters" target="project_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="edit">
            <TextField source="public_name" label="Name" />
            <TextField source="public_units" label="Units" />
            <ReferenceField source="parameter_type_id" reference="parameter_types" link={false}>
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
