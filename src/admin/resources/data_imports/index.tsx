import { useState } from 'react';
import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  DateField,
  Create,
  SimpleForm,
  TextInput,
  ReferenceInput,
  SelectInput,
  FileInput,
  FileField,
  useDataProvider,
  useNotify,
  useRedirect,
} from 'react-admin';
import type { RiverDataProvider } from '../../dataProvider';

const DataImportList = () => (
  <List>
    <Datagrid bulkActionButtons={false}>
      <ReferenceField source="project_id" reference="projects" link="show" emptyText="-">
        <TextField source="name" />
      </ReferenceField>
      <TextField source="source_type" />
      <TextField source="file_name" />
      <TextField source="status" />
      <NumberField source="rows_imported" />
      <NumberField source="rows_failed" />
      <TextField source="error_message" />
      <DateField source="started_at" showTime />
      <DateField source="completed_at" showTime />
      <TextField source="created_by" />
    </Datagrid>
  </List>
);

const DataImportCreate = () => {
  const dataProvider = useDataProvider() as RiverDataProvider;
  const notify = useNotify();
  const redirect = useRedirect();
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (values: Record<string, unknown>) => {
    if (saving) return;
    setSaving(true);
    try {
      const fileWrapper = values.file as { rawFile?: File } | undefined;
      const file = fileWrapper?.rawFile;
      if (!file) {
        notify('Please select a CSV file', { type: 'error' });
        setSaving(false);
        return;
      }
      const params: Record<string, string> = {};
      if (values.project_id) params.project_id = String(values.project_id);
      if (values.source_type) params.source_type = String(values.source_type);
      if (values.created_by) params.created_by = String(values.created_by);

      await dataProvider.uploadCsv(file, params);
      notify('Import started successfully', { type: 'success' });
      redirect('list', 'data_imports');
    } catch {
      notify('Import failed', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Create>
      <SimpleForm onSubmit={handleSubmit}>
        <ReferenceInput source="project_id" reference="projects">
          <SelectInput optionText="name" emptyText="None" />
        </ReferenceInput>
        <TextInput source="source_type" isRequired helperText="e.g. csv, cnet, metalp" />
        <TextInput source="created_by" />
        <FileInput source="file" accept={{ 'text/csv': ['.csv'] }} isRequired>
          <FileField source="src" title="title" />
        </FileInput>
      </SimpleForm>
    </Create>
  );
};

export default {
  list: DataImportList,
  create: DataImportCreate,
};
