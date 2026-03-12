import { useState } from 'react';
import {
  List,
  Datagrid,
  TextField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  useNotify,
  useRefresh,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Button, Box } from '@mui/material';
import AddLocationIcon from '@mui/icons-material/AddLocation';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import { FormulaBuilder, type ParameterTypeInfo } from '../../components/FormulaBuilder';
import { AssignToSiteDialog } from './AssignToSiteDialog';

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

const AssignToSiteButton = () => {
  const record = useRecordContext();
  const [open, setOpen] = useState(false);

  if (!record) return null;

  return (
    <>
      <Button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        size="small"
        color="secondary"
        startIcon={<AddLocationIcon />}
      >
        Assign to Site
      </Button>
      <AssignToSiteDialog
        open={open}
        onClose={() => setOpen(false)}
        definition={{
          id: record.id as string,
          name: record.name as string,
          display_name: record.display_name as string | null,
          formula: record.formula as string,
          units: record.units as string | null,
          required_parameter_types: (record.required_parameter_types ?? []) as string[],
        }}
      />
    </>
  );
};

/** Fetch parameter types for the formula builder variable palette */
const useParameterTypes = (): ParameterTypeInfo[] => {
  const { data } = useGetList('parameters', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });
  return data?.map((pt) => ({
    name: pt.name as string,
    display_name: pt.display_name as string | undefined,
    default_units: pt.default_units as string | undefined,
  })) ?? [];
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
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <RecomputeButton />
        <AssignToSiteButton />
      </Box>
    </Datagrid>
  </List>
);

const DerivedParameterCreateForm = () => {
  const parameterTypes = useParameterTypes();
  return (
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="units" />
      <FormulaBuilder source="formula" isRequired parameterTypes={parameterTypes} />
      <TextInput source="description" multiline />
    </SimpleForm>
  );
};

const DerivedParameterCreate = () => (
  <Create>
    <DerivedParameterCreateForm />
  </Create>
);

const DerivedParameterEditForm = () => {
  const parameterTypes = useParameterTypes();
  return (
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" />
      <TextInput source="units" />
      <FormulaBuilder source="formula" isRequired parameterTypes={parameterTypes} />
      <TextInput source="description" multiline />
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
