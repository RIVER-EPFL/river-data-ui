import { useMemo } from 'react';
import {
  List,
  Datagrid,
  TextField,
  DateField,
  NumberField,
  BooleanField,
  Create,
  Edit,
  Show,
  TabbedShowLayout,
  SimpleForm,
  TextInput,
  ReferenceManyField,
  ReferenceField,
  TopToolbar,
  EditButton,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Chip, Typography, Box } from '@mui/material';
import { useNavigate } from 'react-router-dom';

/** Show count of sites using this parameter (receives pre-computed counts) */
const SiteCountField = (_props: { label?: string; counts?: Map<string, number> }) => {
  const record = useRecordContext();
  const navigate = useNavigate();
  const counts = _props.counts;

  if (!record || !counts) return null;
  const total = counts.get(String(record.id)) ?? 0;
  return (
    <Chip
      label={`${total} site${total !== 1 ? 's' : ''}`}
      size="small"
      variant="outlined"
      color={total > 0 ? 'primary' : 'default'}
      onClick={total > 0 ? (e) => {
        e.stopPropagation();
        navigate(`/site_parameters?filter=${encodeURIComponent(JSON.stringify({ parameter_type_id: record.id }))}`);
      } : undefined}
      sx={total > 0 ? { cursor: 'pointer' } : undefined}
    />
  );
};

/** Show count of sensors measuring this parameter (receives pre-computed counts) */
const SensorCountField = (_props: { label?: string; counts?: Map<string, number> }) => {
  const record = useRecordContext();
  const navigate = useNavigate();
  const counts = _props.counts;

  if (!record || !counts) return null;
  const total = counts.get(String(record.id)) ?? 0;
  return (
    <Chip
      label={`${total} sensor${total !== 1 ? 's' : ''}`}
      size="small"
      variant="outlined"
      color={total > 0 ? 'info' : 'default'}
      onClick={total > 0 ? (e) => {
        e.stopPropagation();
        navigate(`/sensors?filter=${encodeURIComponent(JSON.stringify({ parameter_type_id: record.id }))}`);
      } : undefined}
      sx={total > 0 ? { cursor: 'pointer' } : undefined}
    />
  );
};

/** Wraps Datagrid with bulk-fetched counts for site_parameters and sensors */
const ParameterDatagrid = () => {
  const { data: siteParams } = useGetList('site_parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'id', order: 'ASC' },
  });

  const { data: sensors } = useGetList('sensors', {
    filter: { is_active: true },
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'id', order: 'ASC' },
  });

  const siteCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!siteParams) return map;
    for (const sp of siteParams) {
      const key = sp.parameter_id;
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [siteParams]);

  const sensorCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!sensors) return map;
    for (const s of sensors) {
      const key = s.parameter_id;
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [sensors]);

  return (
    <Datagrid rowClick="show">
      <TextField source="name" />
      <TextField source="display_name" />
      <TextField source="default_units" />
      <TextField source="description" />
      <SiteCountField label="Sites" counts={siteCounts} />
      <SensorCountField label="Sensors" counts={sensorCounts} />
      <DateField source="created_at" showTime />
    </Datagrid>
  );
};

const ParameterList = () => (
  <List>
    <ParameterDatagrid />
  </List>
);

const ParameterCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="default_units" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Create>
);

const ParameterShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <TabbedShowLayout>
      <TabbedShowLayout.Tab label="Overview">
        <TextField source="name" />
        <TextField source="display_name" />
        <TextField source="default_units" />
        <TextField source="category" />
        <TextField source="data_type" />
        <TextField source="description" />
        <Box sx={{ mt: 2, mb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">Default Thresholds</Typography>
        </Box>
        <NumberField source="default_warning_min" label="Warning Min" emptyText="—" />
        <NumberField source="default_warning_max" label="Warning Max" emptyText="—" />
        <NumberField source="default_alarm_min" label="Alarm Min" emptyText="—" />
        <NumberField source="default_alarm_max" label="Alarm Max" emptyText="—" />
        <DateField source="created_at" showTime />
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Site Assignments">
        <ReferenceManyField reference="site_parameters" target="parameter_type_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="show">
            <ReferenceField source="site_id" reference="sites" link="show">
              <TextField source="name" />
            </ReferenceField>
            <TextField source="name" label="Parameter Name" />
            <TextField source="display_units" />
            <BooleanField source="is_active" />
            <BooleanField source="is_derived" />
          </Datagrid>
        </ReferenceManyField>
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Sensors">
        <ReferenceManyField reference="sensors" target="parameter_type_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="show">
            <TextField source="serial_number" />
            <TextField source="name" />
            <TextField source="manufacturer" />
            <TextField source="model" />
            <BooleanField source="is_active" />
          </Datagrid>
        </ReferenceManyField>
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  </Show>
);

const ParameterEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="default_units" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: ParameterList,
  show: ParameterShow,
  create: ParameterCreate,
  edit: ParameterEdit,
};
