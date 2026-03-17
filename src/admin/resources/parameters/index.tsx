import { useMemo } from 'react';
import {
  List,
  Datagrid,
  TextField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Chip } from '@mui/material';
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
      const key = sp.parameter_type_id;
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [siteParams]);

  const sensorCounts = useMemo(() => {
    const map = new Map<string, number>();
    if (!sensors) return map;
    for (const s of sensors) {
      const key = s.parameter_type_id;
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [sensors]);

  return (
    <Datagrid rowClick="edit">
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
  create: ParameterCreate,
  edit: ParameterEdit,
};
