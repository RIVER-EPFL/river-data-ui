import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  BooleanField,
  DateField,
  Show,
  SimpleShowLayout,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  BooleanInput,
  TopToolbar,
  EditButton,
} from 'react-admin';

const ParameterList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
      <ReferenceField source="parameter_type_id" reference="parameter_types" link="edit">
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

const ParameterShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
      <ReferenceField source="parameter_type_id" reference="parameter_types" link="edit">
        <TextField source="display_name" />
      </ReferenceField>
      <TextField source="sensor_type" />
      <TextField source="display_units" />
      <TextField source="units_name" />
      <NumberField source="units_min" />
      <NumberField source="units_max" />
      <NumberField source="decimal_places" />
      <NumberField source="channel_id" />
      <NumberField source="sample_interval_sec" />
      <BooleanField source="is_active" />
      <BooleanField source="is_derived" />
      <ReferenceField source="derived_definition_id" reference="derived_parameters" link="edit" emptyText="-">
        <TextField source="name" />
      </ReferenceField>
      <DateField source="created_at" showTime />
      <DateField source="updated_at" showTime />
      <DateField source="discovered_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const ParameterEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" />
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
