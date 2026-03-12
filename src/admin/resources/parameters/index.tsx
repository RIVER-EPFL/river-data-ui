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
import { Chip, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

/** Show count of sites using this parameter */
const SiteCountField = (_props: { label?: string }) => {
  const record = useRecordContext();
  const navigate = useNavigate();
  const { total } = useGetList('site_parameters', {
    filter: record ? { parameter_type_id: record.id } : {},
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'name', order: 'ASC' },
  }, { enabled: !!record });

  if (total === undefined) return null;
  return (
    <Chip
      label={`${total} site${total !== 1 ? 's' : ''}`}
      size="small"
      variant="outlined"
      color={total > 0 ? 'primary' : 'default'}
      onClick={total > 0 && record ? (e) => {
        e.stopPropagation();
        navigate(`/site_parameters?filter=${encodeURIComponent(JSON.stringify({ parameter_type_id: record.id }))}`);
      } : undefined}
      sx={total > 0 ? { cursor: 'pointer' } : undefined}
    />
  );
};

/** Show count of sensors measuring this parameter */
const SensorCountField = (_props: { label?: string }) => {
  const record = useRecordContext();
  const navigate = useNavigate();
  const { total } = useGetList('sensors', {
    filter: record ? { parameter_type_id: record.id, is_active: true } : {},
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'name', order: 'ASC' },
  }, { enabled: !!record });

  if (total === undefined) return null;
  return (
    <Chip
      label={`${total} sensor${total !== 1 ? 's' : ''}`}
      size="small"
      variant="outlined"
      color={total > 0 ? 'info' : 'default'}
      onClick={total > 0 && record ? (e) => {
        e.stopPropagation();
        navigate(`/sensors?filter=${encodeURIComponent(JSON.stringify({ parameter_type_id: record.id }))}`);
      } : undefined}
      sx={total > 0 ? { cursor: 'pointer' } : undefined}
    />
  );
};

const ParameterList = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="name" />
      <TextField source="display_name" />
      <TextField source="default_units" />
      <TextField source="description" />
      <SiteCountField label="Sites" />
      <SensorCountField label="Sensors" />
      <DateField source="created_at" showTime />
    </Datagrid>
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
