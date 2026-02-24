import {
  List,
  Datagrid,
  TextField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  useDataProvider,
  useNotify,
  useRefresh,
  useRecordContext,
} from 'react-admin';
import { Button } from '@mui/material';
import type { RiverDataProvider } from '../../dataProvider';

const RecomputeButton = () => {
  const record = useRecordContext();
  const dataProvider = useDataProvider() as RiverDataProvider;
  const notify = useNotify();
  const refresh = useRefresh();

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record) return;
    try {
      await dataProvider.recomputeDerived(record.id as string);
      notify('Recompute triggered', { type: 'success' });
      refresh();
    } catch {
      notify('Recompute failed', { type: 'error' });
    }
  };

  return (
    <Button onClick={handleClick} size="small" color="primary">
      Recompute
    </Button>
  );
};

const jsonParse = (v: string) => {
  try { return JSON.parse(v); } catch { return v; }
};
const jsonFormat = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);

const DerivedParameterList = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="name" />
      <TextField source="display_name" />
      <TextField source="units" />
      <TextField source="formula" />
      <TextField source="description" />
      <DateField source="created_at" showTime />
      <RecomputeButton />
    </Datagrid>
  </List>
);

const DerivedParameterCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="units" />
      <TextInput source="formula" isRequired helperText="Math expression, e.g. slope * x + intercept" />
      <TextInput source="description" multiline />
      <TextInput
        source="required_parameter_types"
        multiline
        parse={jsonParse}
        format={jsonFormat}
        helperText="JSON array of required parameter type names"
      />
    </SimpleForm>
  </Create>
);

const DerivedParameterEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="units" />
      <TextInput source="formula" isRequired helperText="Math expression, e.g. slope * x + intercept" />
      <TextInput source="description" multiline />
      <TextInput
        source="required_parameter_types"
        multiline
        parse={jsonParse}
        format={jsonFormat}
        helperText="JSON array of required parameter type names"
      />
    </SimpleForm>
  </Edit>
);

export default {
  list: DerivedParameterList,
  create: DerivedParameterCreate,
  edit: DerivedParameterEdit,
};
