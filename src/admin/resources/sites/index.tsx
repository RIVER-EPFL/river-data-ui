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
  AutocompleteInput,
} from 'react-admin';
import StationHub from './StationHub';

const siteFilters = [
  <TextInput source="q" label="Search" alwaysOn key="q" />,
  <ReferenceInput source="project_id" reference="projects" key="project" alwaysOn>
    <AutocompleteInput optionText="name" label="Project" />
  </ReferenceInput>,
];

const SiteList = () => (
  <List filters={siteFilters} sort={{ field: 'name', order: 'ASC' }}>
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
      <NumberInput source="latitude" helperText="Decimal degrees, WGS84 (e.g. 46.5197)" />
      <NumberInput source="longitude" helperText="Decimal degrees, WGS84 (e.g. 6.6323)" />
      <NumberInput source="altitude_m" helperText="Meters above sea level" />
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
      <NumberInput source="latitude" helperText="Decimal degrees, WGS84 (e.g. 46.5197)" />
      <NumberInput source="longitude" helperText="Decimal degrees, WGS84 (e.g. 6.6323)" />
      <NumberInput source="altitude_m" helperText="Meters above sea level" />
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
