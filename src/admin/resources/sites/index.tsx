import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  DateField,
  Show,
  SimpleShowLayout,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  ReferenceInput,
  SelectInput,
  TopToolbar,
  EditButton,
} from 'react-admin';

const SiteList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <ReferenceField source="project_id" reference="projects" link="show">
        <TextField source="name" />
      </ReferenceField>
      <NumberField source="latitude" />
      <NumberField source="longitude" />
      <NumberField source="altitude_m" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const SiteShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <ReferenceField source="project_id" reference="projects" link="show">
        <TextField source="name" />
      </ReferenceField>
      <NumberField source="latitude" />
      <NumberField source="longitude" />
      <NumberField source="altitude_m" />
      <DateField source="created_at" showTime />
      <DateField source="discovered_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const SiteEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" />
      <ReferenceInput source="project_id" reference="projects">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <NumberInput source="latitude" />
      <NumberInput source="longitude" />
      <NumberInput source="altitude_m" />
    </SimpleForm>
  </Edit>
);

export default {
  list: SiteList,
  show: SiteShow,
  edit: SiteEdit,
};
