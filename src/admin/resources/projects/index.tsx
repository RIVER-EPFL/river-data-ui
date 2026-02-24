import {
  List,
  Datagrid,
  TextField,
  DateField,
  Show,
  SimpleShowLayout,
  Edit,
  SimpleForm,
  TextInput,
  TopToolbar,
  EditButton,
} from 'react-admin';

const ProjectList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <TextField source="data_source" />
      <TextField source="description" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const ProjectShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <TextField source="data_source" />
      <TextField source="description" />
      <DateField source="created_at" showTime />
      <DateField source="discovered_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const ProjectEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" />
      <TextInput source="data_source" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: ProjectList,
  show: ProjectShow,
  edit: ProjectEdit,
};
