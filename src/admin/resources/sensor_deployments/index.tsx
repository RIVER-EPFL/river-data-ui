import {
  List,
  Datagrid,
  TextField,
  ReferenceField,
  DateField,
  FunctionField,
  Create,
  Edit,
  Show,
  SimpleShowLayout,
  SimpleForm,
  TextInput,
  ReferenceInput,
  SelectInput,
  DateTimeInput,
  TopToolbar,
  EditButton,
  Filter,
  BooleanInput,
} from 'react-admin';
import { Chip } from '@mui/material';

const ActiveBadge = ({ deployedUntil }: { deployedUntil: string | null }) =>
  deployedUntil === null ? (
    <Chip label="Active" color="success" />
  ) : (
    <Chip label="Ended" color="default" variant="outlined" />
  );

const DeploymentFilters = (props: object) => (
  <Filter {...props}>
    <BooleanInput source="_activeOnly" label="Active only" alwaysOn />
    <ReferenceInput source="sensor_id" reference="sensors">
      <SelectInput optionText="serial_number" label="Sensor" />
    </ReferenceInput>
    <ReferenceInput source="site_id" reference="sites">
      <SelectInput optionText="name" label="Site" />
    </ReferenceInput>
  </Filter>
);

const SensorDeploymentList = () => (
  <List filters={<DeploymentFilters />} sort={{ field: 'deployed_from', order: 'DESC' }}>
    <Datagrid rowClick="show">
      <FunctionField
        label="Status"
        render={(d: { deployed_until: string | null }) => (
          <ActiveBadge deployedUntil={d.deployed_until} />
        )}
      />
      <ReferenceField source="sensor_id" reference="sensors" link="show">
        <TextField source="serial_number" />
      </ReferenceField>
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
      <TextField source="deployment_type" />
      <DateField source="deployed_from" showTime />
      <DateField source="deployed_until" showTime emptyText="—" />
      <TextField source="notes" />
    </Datagrid>
  </List>
);

const SensorDeploymentShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <FunctionField
        label="Status"
        render={(d: { deployed_until: string | null }) => (
          <ActiveBadge deployedUntil={d.deployed_until} />
        )}
      />
      <ReferenceField source="sensor_id" reference="sensors" link="show">
        <TextField source="serial_number" />
      </ReferenceField>
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
      <TextField source="deployment_type" />
      <DateField source="deployed_from" showTime />
      <DateField source="deployed_until" showTime emptyText="Active" />
      <TextField source="notes" />
      <DateField source="created_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const SensorDeploymentCreate = () => (
  <Create>
    <SimpleForm>
      <ReferenceInput source="sensor_id" reference="sensors">
        <SelectInput optionText="serial_number" />
      </ReferenceInput>
      <ReferenceInput source="site_id" reference="sites">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <DateTimeInput source="deployed_from" isRequired />
      <DateTimeInput source="deployed_until" helperText="Leave blank if active." />
      <TextInput source="deployment_type" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Create>
);

const SensorDeploymentEdit = () => (
  <Edit>
    <SimpleForm>
      <ReferenceInput source="sensor_id" reference="sensors">
        <SelectInput optionText="serial_number" />
      </ReferenceInput>
      <ReferenceInput source="site_id" reference="sites">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <DateTimeInput
        source="deployed_from"
        isRequired
        helperText="Adjust to trim noisy readings around physical handling."
      />
      <DateTimeInput
        source="deployed_until"
        helperText="Leave blank if active. Adjust to trim noisy readings around recall."
      />
      <TextInput source="deployment_type" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: SensorDeploymentList,
  show: SensorDeploymentShow,
  create: SensorDeploymentCreate,
  edit: SensorDeploymentEdit,
};
