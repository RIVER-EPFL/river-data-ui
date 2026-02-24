import {
  List,
  Datagrid,
  TextField,
  ReferenceField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  ReferenceInput,
  SelectInput,
  DateTimeInput,
} from 'react-admin';

const SensorDeploymentList = () => (
  <List>
    <Datagrid rowClick="edit">
      <ReferenceField source="sensor_id" reference="sensors" link="show">
        <TextField source="serial_number" />
      </ReferenceField>
      <ReferenceField source="parameter_id" reference="parameters" link="show">
        <TextField source="name" />
      </ReferenceField>
      <TextField source="deployment_type" />
      <DateField source="deployed_from" showTime />
      <DateField source="deployed_until" showTime />
      <TextField source="notes" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const SensorDeploymentCreate = () => (
  <Create>
    <SimpleForm>
      <ReferenceInput source="sensor_id" reference="sensors">
        <SelectInput optionText="serial_number" />
      </ReferenceInput>
      <ReferenceInput source="parameter_id" reference="parameters">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <DateTimeInput source="deployed_from" isRequired />
      <DateTimeInput source="deployed_until" />
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
      <ReferenceInput source="parameter_id" reference="parameters">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <DateTimeInput source="deployed_from" isRequired />
      <DateTimeInput source="deployed_until" />
      <TextInput source="deployment_type" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: SensorDeploymentList,
  create: SensorDeploymentCreate,
  edit: SensorDeploymentEdit,
};
