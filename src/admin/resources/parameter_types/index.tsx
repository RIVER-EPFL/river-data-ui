import {
  List,
  Datagrid,
  TextField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
} from 'react-admin';

const ParameterTypeList = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="name" />
      <TextField source="display_name" />
      <TextField source="default_units" />
      <TextField source="description" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const ParameterTypeCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="default_units" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Create>
);

const ParameterTypeEdit = () => (
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
  list: ParameterTypeList,
  create: ParameterTypeCreate,
  edit: ParameterTypeEdit,
};
