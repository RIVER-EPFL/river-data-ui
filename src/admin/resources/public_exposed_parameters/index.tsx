import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  BooleanField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  BooleanInput,
  ReferenceInput,
  SelectInput,
} from 'react-admin';

const PublicExposedParameterList = () => (
  <List>
    <Datagrid rowClick="edit">
      <ReferenceField source="project_id" reference="projects" link="show">
        <TextField source="name" />
      </ReferenceField>
      <TextField source="public_name" />
      <TextField source="public_units" label="Units" />
      <ReferenceField source="parameter_type_id" reference="parameters" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <TextField source="description" />
      <NumberField source="sort_order" />
      <BooleanField source="include_derived" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const PublicExposedParameterCreate = () => (
  <Create>
    <SimpleForm>
      <ReferenceInput source="project_id" reference="projects">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <ReferenceInput source="parameter_type_id" reference="parameters">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="public_name" isRequired helperText="Name shown in public API responses" />
      <TextInput source="public_units" isRequired helperText="Units shown in public API responses" />
      <TextInput source="description" multiline />
      <NumberInput source="sort_order" defaultValue={0} />
      <BooleanInput source="include_derived" defaultValue={false} />
    </SimpleForm>
  </Create>
);

const PublicExposedParameterEdit = () => (
  <Edit>
    <SimpleForm>
      <ReferenceInput source="project_id" reference="projects">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <ReferenceInput source="parameter_type_id" reference="parameters">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="public_name" isRequired helperText="Name shown in public API responses" />
      <TextInput source="public_units" isRequired helperText="Units shown in public API responses" />
      <TextInput source="description" multiline />
      <NumberInput source="sort_order" />
      <BooleanInput source="include_derived" />
    </SimpleForm>
  </Edit>
);

export default {
  list: PublicExposedParameterList,
  create: PublicExposedParameterCreate,
  edit: PublicExposedParameterEdit,
};
