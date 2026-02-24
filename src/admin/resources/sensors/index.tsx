import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  DateField,
  ReferenceField,
  Show,
  SimpleShowLayout,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  BooleanInput,
  ReferenceInput,
  SelectInput,
  TopToolbar,
  EditButton,
} from 'react-admin';

const SensorList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="serial_number" />
      <TextField source="name" />
      <ReferenceField source="parameter_type_id" reference="parameter_types" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <TextField source="manufacturer" />
      <TextField source="model" />
      <BooleanField source="is_active" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const SensorShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="serial_number" />
      <TextField source="name" />
      <ReferenceField source="parameter_type_id" reference="parameter_types" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <TextField source="manufacturer" />
      <TextField source="model" />
      <BooleanField source="is_active" />
      <TextField source="notes" />
      <DateField source="created_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const SensorCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="serial_number" isRequired />
      <TextInput source="name" />
      <ReferenceInput source="parameter_type_id" reference="parameter_types">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="manufacturer" />
      <TextInput source="model" />
      <BooleanInput source="is_active" defaultValue={true} />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Create>
);

const SensorEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="serial_number" isRequired />
      <TextInput source="name" />
      <ReferenceInput source="parameter_type_id" reference="parameter_types">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="manufacturer" />
      <TextInput source="model" />
      <BooleanInput source="is_active" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: SensorList,
  show: SensorShow,
  create: SensorCreate,
  edit: SensorEdit,
};
