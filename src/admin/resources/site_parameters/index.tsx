import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  BooleanField,
  DateField,
  FunctionField,
  Show,
  TabbedShowLayout,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  BooleanInput,
  ReferenceInput,
  SelectInput,
  ReferenceManyField,
  TopToolbar,
  EditButton,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Typography } from '@mui/material';

const ParameterList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
      <ReferenceField source="parameter_type_id" reference="parameters" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <TextField source="sensor_type" />
      <TextField source="display_units" />
      <NumberField source="sample_interval_sec" />
      <BooleanField source="is_active" />
      <BooleanField source="is_derived" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const ParameterSensorInfo = () => {
  const record = useRecordContext();

  const { data: deployments } = useGetList('sensor_deployments', {
    filter: record ? { parameter_id: record.id } : {},
    sort: { field: 'deployed_from', order: 'DESC' },
    pagination: { page: 1, perPage: 10 },
  }, { enabled: !!record });

  const activeDep = deployments?.find(d => !d.deployed_until);
  const { data: calibrations } = useGetList('sensor_calibrations', {
    filter: activeDep ? { sensor_id: activeDep.sensor_id } : {},
    sort: { field: 'valid_from', order: 'DESC' },
    pagination: { page: 1, perPage: 20 },
  }, { enabled: !!activeDep });

  if (!record) return null;

  return (
    <>
      <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
        Deployment History
      </Typography>
      <ReferenceManyField reference="sensor_deployments" target="parameter_id"
        sort={{ field: 'deployed_from', order: 'DESC' }} label={false}>
        <Datagrid bulkActionButtons={false}>
          <ReferenceField source="sensor_id" reference="sensors" link="show">
            <TextField source="serial_number" />
          </ReferenceField>
          <DateField source="deployed_from" showTime />
          <DateField source="deployed_until" showTime emptyText="Active" />
          <TextField source="deployment_type" />
        </Datagrid>
      </ReferenceManyField>

      <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold', mt: 3 }}>
        Calibration History
      </Typography>
      {activeDep && calibrations && calibrations.length > 0 ? (
        <ReferenceManyField reference="sensor_calibrations" target="sensor_id"
          filter={{ sensor_id: activeDep.sensor_id }}
          sort={{ field: 'valid_from', order: 'DESC' }} label={false}>
          <Datagrid bulkActionButtons={false}>
            <NumberField source="slope" />
            <NumberField source="intercept" />
            <FunctionField label="Equation" render={(record: { slope: number; intercept: number }) =>
              `y = ${record.slope}x + ${record.intercept}`
            } />
            <DateField source="valid_from" showTime />
            <TextField source="performed_by" />
          </Datagrid>
        </ReferenceManyField>
      ) : (
        <Typography color="text.secondary">
          {activeDep ? 'No calibrations recorded' : 'No active sensor deployment'}
        </Typography>
      )}
    </>
  );
};

const ParameterShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <TabbedShowLayout>
      <TabbedShowLayout.Tab label="Overview">
        <TextField source="name" />
        <ReferenceField source="site_id" reference="sites" link="show">
          <TextField source="name" />
        </ReferenceField>
        <ReferenceField source="parameter_type_id" reference="parameters" link={false}>
          <TextField source="display_name" />
        </ReferenceField>
        <TextField source="sensor_type" />
        <TextField source="display_units" />
        <NumberField source="units_min" />
        <NumberField source="units_max" />
        <NumberField source="decimal_places" />
        <NumberField source="sample_interval_sec" />
        <BooleanField source="is_active" />
        <BooleanField source="is_derived" />
        <ReferenceField source="derived_definition_id" reference="derived_parameters" link="edit" emptyText="-">
          <TextField source="name" />
        </ReferenceField>
        <DateField source="created_at" showTime />
        <DateField source="updated_at" showTime />
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Alarms">
        <ReferenceManyField reference="alarm_thresholds" target="parameter_id" label={false}>
          <Datagrid bulkActionButtons={false} rowClick="edit">
            <NumberField source="warning_min" />
            <NumberField source="warning_max" />
            <NumberField source="alarm_min" />
            <NumberField source="alarm_max" />
            <TextField source="description" />
            <DateField source="updated_at" showTime />
          </Datagrid>
        </ReferenceManyField>
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Sensor & Calibration">
        <ParameterSensorInfo />
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  </Show>
);

const ParameterEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" />
      <ReferenceInput source="site_id" reference="sites">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <ReferenceInput source="parameter_type_id" reference="parameters">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="sensor_type" />
      <TextInput source="display_units" />
      <TextInput source="units_name" />
      <NumberInput source="units_min" />
      <NumberInput source="units_max" />
      <NumberInput source="decimal_places" />
      <NumberInput source="channel_id" />
      <NumberInput source="sample_interval_sec" />
      <BooleanInput source="is_active" />
      <BooleanInput source="is_derived" />
    </SimpleForm>
  </Edit>
);

export default {
  list: ParameterList,
  show: ParameterShow,
  edit: ParameterEdit,
};
