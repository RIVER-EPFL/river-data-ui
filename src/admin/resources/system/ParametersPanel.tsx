import {
  List,
  Datagrid,
  TextField,
  DateField,
  TopToolbar,
  CreateButton,
} from 'react-admin';

const ListActions = () => (
  <TopToolbar>
    <CreateButton resource="parameters" />
  </TopToolbar>
);

export const ParametersPanel = () => (
  <List resource="parameters" actions={<ListActions />} title=" ">
    <Datagrid rowClick="edit">
      <TextField source="name" />
      <TextField source="display_name" />
      <TextField source="default_units" />
      <TextField source="description" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);
