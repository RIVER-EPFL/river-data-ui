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
  NumberInput,
  SelectInput,
  ReferenceManyField,
  ReferenceField,
  FunctionField,
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
      variant="outlined"
      color={total > 0 ? 'primary' : 'default'}
      onClick={total > 0 ? (e) => {
        e.stopPropagation();
        navigate(`/site_parameters?filter=${encodeURIComponent(JSON.stringify({ parameter_id: record.id }))}`);
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
      variant="outlined"
      color={total > 0 ? 'info' : 'default'}
      onClick={total > 0 ? (e) => {
        e.stopPropagation();
        navigate(`/sensors?filter=${encodeURIComponent(JSON.stringify({ parameter_id: record.id }))}`);
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

const useCategoryChoices = () => {
  const { data } = useGetList('parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'category', order: 'ASC' },
  });
  return useMemo(() => {
    if (!data) return [];
    const cats = [...new Set(data.map((p) => p.category as string))].sort();
    return cats.map((c) => ({ id: c, name: c }));
  }, [data]);
};

const ParameterFilters = () => {
  const categoryChoices = useCategoryChoices();
  return [
    <TextInput source="q" label="Search" alwaysOn key="q" />,
    <SelectInput source="category" label="Category" key="category" choices={categoryChoices} />,
  ];
};

const ParameterList = () => {
  const filters = ParameterFilters();
  return (
    <List filters={filters} sort={{ field: 'name', order: 'ASC' }}>
      <ParameterDatagrid />
    </List>
  );
};

const PARAMETER_DATA_TYPES = [
  { id: 'float', name: 'Float (numeric)' },
  { id: 'int', name: 'Integer' },
  { id: 'string', name: 'String' },
  { id: 'bool', name: 'Boolean' },
];

const ParameterCreate = () => {
  const categoryChoices = useCategoryChoices();
  return (
  <Create>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="default_units" />
      <SelectInput source="category" choices={categoryChoices} defaultValue="measurement" />
      <SelectInput source="data_type" choices={PARAMETER_DATA_TYPES} defaultValue="float" />
      <TextInput source="description" multiline />
      <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
        Default Thresholds (optional)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        Used as fallback when no site-specific override exists.
      </Typography>
      <NumberInput source="default_warning_min" label="Warning Min" />
      <NumberInput source="default_warning_max" label="Warning Max" />
      <NumberInput source="default_alarm_min" label="Alarm Min" />
      <NumberInput source="default_alarm_max" label="Alarm Max" />
    </SimpleForm>
  </Create>
  );
};

/** Show current deployment site for a sensor */
const SensorCurrentSite = () => {
  const record = useRecordContext();
  const { data: deployments } = useGetList('sensor_deployments', {
    filter: record ? { sensor_id: record.id } : {},
    sort: { field: 'deployed_from', order: 'DESC' },
    pagination: { page: 1, perPage: 1 },
  }, { enabled: !!record });

  const active = deployments?.find((d: { deployed_until: string | null }) => !d.deployed_until);
  if (!active) return <Typography variant="body2" color="text.disabled">Not deployed</Typography>;

  return (
    <ReferenceField source="parameter_id" reference="site_parameters" record={active} link={false}>
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
    </ReferenceField>
  );
};

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
        <ReferenceManyField reference="site_parameters" target="parameter_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="show">
            <ReferenceField source="site_id" reference="sites" link="show">
              <TextField source="name" />
            </ReferenceField>
            <TextField source="name" label="Parameter Name" />
            <TextField source="display_units" />
            <TextField source="sensor_type" />
            <NumberField source="sample_interval_sec" label="Interval (s)" />
            <BooleanField source="is_active" />
            <BooleanField source="is_derived" />
          </Datagrid>
        </ReferenceManyField>
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Sensors">
        <ReferenceManyField reference="sensors" target="parameter_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="show">
            <TextField source="serial_number" />
            <TextField source="name" />
            <TextField source="manufacturer" />
            <TextField source="model" />
            <BooleanField source="is_active" />
            <FunctionField label="Current Site" render={() => <SensorCurrentSite />} />
          </Datagrid>
        </ReferenceManyField>
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  </Show>
);

const ParameterEdit = () => {
  const categoryChoices = useCategoryChoices();
  return (
  <Edit>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="default_units" />
      <SelectInput source="category" choices={categoryChoices} />
      <SelectInput source="data_type" choices={PARAMETER_DATA_TYPES} />
      <TextInput source="description" multiline />
      <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
        Default Thresholds
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        Site-specific thresholds override these defaults at read time.
      </Typography>
      <NumberInput source="default_warning_min" label="Warning Min" />
      <NumberInput source="default_warning_max" label="Warning Max" />
      <NumberInput source="default_alarm_min" label="Alarm Min" />
      <NumberInput source="default_alarm_max" label="Alarm Max" />
    </SimpleForm>
  </Edit>
  );
};

export default {
  list: ParameterList,
  show: ParameterShow,
  create: ParameterCreate,
  edit: ParameterEdit,
};
