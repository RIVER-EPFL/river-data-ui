import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  DateField,
  Edit,
  Create,
  SimpleForm,
  TextInput,
  NumberInput,
  ReferenceInput,
  SelectInput,
} from 'react-admin';
import StationHub from './StationHub';

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

const SiteCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <ReferenceInput source="project_id" reference="projects">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <NumberInput source="latitude" />
      <NumberInput source="longitude" />
      <NumberInput source="altitude_m" />
      <TextInput source="public_slug" helperText="URL-safe identifier for public API. Leave blank to exclude." />
    </SimpleForm>
  </Create>
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
      <TextInput source="public_slug" helperText="URL-safe identifier for public API. Leave blank to exclude." />
    </SimpleForm>
  </Edit>
);

export default {
  list: SiteList,
  show: StationHub,
  create: SiteCreate,
  edit: SiteEdit,
};
