import { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  List,
  Datagrid,
  TextField,
  DateField,
  BooleanField,
  Create,
  Edit,
  Show,
  SimpleShowLayout,
  SimpleForm,
  TextInput,
  ArrayField,
  ReferenceManyField,
  ReferenceField,
  TopToolbar,
  EditButton,
  useNotify,
  useRefresh,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Button, Box, CircularProgress, Divider, Typography } from '@mui/material';
import AddLocationIcon from '@mui/icons-material/AddLocation';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import { FormulaBuilder, type ParameterTypeInfo } from '../../components/FormulaBuilder';
import { AssignToSiteDialog } from './AssignToSiteDialog';

const LazyFormulaPreviewChart = lazy(() =>
  import('../../components/FormulaPreviewChart').then((mod) => ({
    default: mod.FormulaPreviewChart,
  })),
);

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
          sources: (record.sources ?? []) as Array<{id: string; derived_definition_id: string; parameter_id: string; variable_name: string}>,
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
    <Datagrid rowClick="show">
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

/** Per-row recompute button for assigned sites */
const AssignmentRecomputeButton = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  if (!record?.derived_definition_id) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dataProvider.recomputeDerived(record.derived_definition_id as string);
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

const MATH_FUNCTIONS = new Set([
  'sqrt', 'abs', 'ln', 'log', 'exp', 'sin', 'cos', 'tan', 'min', 'max', 'pi', 'e',
]);

/** Extract variable names from a formula string */
function extractFormulaVariables(formula: string, knownParams: string[]): string[] {
  const known = new Set(knownParams);
  const tokens = formula.match(/\b[a-zA-Z_]\w*\b/g) ?? [];
  return [...new Set(tokens.filter((t) => !MATH_FUNCTIONS.has(t) && known.has(t)))];
}

/** Preview + assign section inside the show page */
const PreviewSection = () => {
  const record = useRecordContext();
  const [previewSiteId, setPreviewSiteId] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);

  const { data: allParams } = useGetList('parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const handleSiteChange = useCallback((id: string) => {
    setPreviewSiteId(id);
  }, []);

  const paramNames = useMemo(() => (allParams ?? []).map((p) => p.name as string), [allParams]);

  if (!record) return null;

  const formula = record.formula as string;
  const requiredVariables = extractFormulaVariables(formula, paramNames);
  const sources = (record.sources ?? []) as Array<{
    id: string;
    derived_definition_id: string;
    parameter_id: string;
    variable_name: string;
  }>;

  return (
    <>
      <Suspense fallback={<CircularProgress size={24} />}>
        <LazyFormulaPreviewChart
          formula={formula}
          requiredVariables={requiredVariables}
          onSiteChange={handleSiteChange}
        />
      </Suspense>
      {previewSiteId && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddLocationIcon />}
            onClick={() => setAssignOpen(true)}
          >
            Assign to This Site
          </Button>
        </Box>
      )}
      <AssignToSiteDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        definition={{
          id: record.id as string,
          name: record.name as string,
          display_name: record.display_name as string | null,
          formula,
          units: record.units as string | null,
          sources,
        }}
        preselectedSiteId={previewSiteId}
      />
    </>
  );
};

const DerivedParameterShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <TextField source="name" />
      <TextField source="display_name" />
      <TextField source="units" />
      <Box
        component="pre"
        sx={{
          bgcolor: 'grey.100',
          p: 1.5,
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          overflow: 'auto',
        }}
      >
        <TextField source="formula" />
      </Box>
      <TextField source="description" />
      <DateField source="created_at" showTime />

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle1" gutterBottom>Sources</Typography>
      <ArrayField source="sources">
        <Datagrid bulkActionButtons={false}>
          <TextField source="variable_name" label="Variable" />
          <ReferenceField source="parameter_id" reference="parameters" link="show">
            <TextField source="display_name" />
          </ReferenceField>
        </Datagrid>
      </ArrayField>

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle1" gutterBottom>Preview</Typography>
      <PreviewSection />

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle1" gutterBottom>Assigned Sites</Typography>
      <ReferenceManyField reference="site_parameters" target="derived_definition_id" label={false}>
        <Datagrid bulkActionButtons={false} rowClick="show">
          <ReferenceField source="site_id" reference="sites" link="show">
            <TextField source="name" />
          </ReferenceField>
          <TextField source="name" label="Parameter Name" />
          <TextField source="display_units" />
          <BooleanField source="is_active" />
          <AssignmentRecomputeButton />
        </Datagrid>
      </ReferenceManyField>
    </SimpleShowLayout>
  </Show>
);

const DerivedParameterCreateForm = () => {
  const parameterTypes = useParameterTypes();
  return (
    <SimpleForm>
      <TextInput source="name" isRequired />
      <TextInput source="display_name" isRequired />
      <TextInput source="units" isRequired />
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
      <TextInput source="display_name" isRequired />
      <TextInput source="units" isRequired />
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
  show: DerivedParameterShow,
  create: DerivedParameterCreate,
  edit: DerivedParameterEdit,
};
