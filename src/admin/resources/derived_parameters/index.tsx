import {
  List,
  Datagrid,
  TextField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  ReferenceArrayInput,
  AutocompleteArrayInput,
  useNotify,
  useRefresh,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Button } from '@mui/material';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import { FormulaBuilder } from '../../components/FormulaBuilder';

const RecomputeButton = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
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

/** Fetch parameter type names for the formula builder variable palette */
const useParameterTypeNames = (): string[] => {
  const { data } = useGetList('parameter_types', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });
  return data?.map((pt) => pt.name as string) ?? [];
};

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

const DerivedParameterCreateForm = () => {
  const parameterTypes = useParameterTypeNames();
  return (
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="units" />
      <FormulaBuilder source="formula" isRequired parameterTypes={parameterTypes} />
      <TextInput source="description" multiline />
      <ReferenceArrayInput source="required_parameter_types" reference="parameter_types">
        <AutocompleteArrayInput optionText="display_name" helperText="Select required parameter types" />
      </ReferenceArrayInput>
    </SimpleForm>
  );
};

const DerivedParameterCreate = () => (
  <Create>
    <DerivedParameterCreateForm />
  </Create>
);

const DerivedParameterEditForm = () => {
  const parameterTypes = useParameterTypeNames();
  return (
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="units" />
      <FormulaBuilder source="formula" isRequired parameterTypes={parameterTypes} />
      <TextInput source="description" multiline />
      <ReferenceArrayInput source="required_parameter_types" reference="parameter_types">
        <AutocompleteArrayInput optionText="display_name" helperText="Select required parameter types" />
      </ReferenceArrayInput>
    </SimpleForm>
  );
};

const DerivedParameterEdit = () => (
  <Edit>
    <DerivedParameterEditForm />
  </Edit>
);

export default {
  list: DerivedParameterList,
  create: DerivedParameterCreate,
  edit: DerivedParameterEdit,
};
