import {
  List,
  Datagrid,
  TextField,
  NumberField,
  Show,
  SimpleShowLayout,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  TopToolbar,
  EditButton,
} from 'react-admin';

const ConstantList = () => (
  <List sort={{ field: 'name', order: 'ASC' }}>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <NumberField source="value" options={{ maximumFractionDigits: 10 }} />
      <TextField source="units" />
      <TextField source="description" />
    </Datagrid>
  </List>
);

const ConstantShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <TextField source="name" />
      <NumberField source="value" options={{ maximumFractionDigits: 10 }} />
      <TextField source="units" />
      <TextField source="description" />
    </SimpleShowLayout>
  </Show>
);

const ConstantCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <NumberInput source="value" isRequired />
      <TextInput source="units" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Create>
);

const ConstantEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <NumberInput source="value" isRequired />
      <TextInput source="units" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: ConstantList,
  show: ConstantShow,
  create: ConstantCreate,
  edit: ConstantEdit,
};
