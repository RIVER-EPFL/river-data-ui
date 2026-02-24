import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  DateField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  ReferenceInput,
  SelectInput,
  DateTimeInput,
  useDataProvider,
  useNotify,
  useRefresh,
  useRecordContext,
} from 'react-admin';
import { Button } from '@mui/material';
import type { RiverDataProvider } from '../../dataProvider';

const RecalculateButton = () => {
  const record = useRecordContext();
  const dataProvider = useDataProvider() as RiverDataProvider;
  const notify = useNotify();
  const refresh = useRefresh();

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record) return;
    try {
      const result = await dataProvider.recalibrateCalibration(record.id as string);
      const data = result.data as { rows_updated?: number };
      notify(`Recalculated ${data.rows_updated ?? 0} rows`, { type: 'success' });
      refresh();
    } catch {
      notify('Recalculation failed', { type: 'error' });
    }
  };

  return (
    <Button onClick={handleClick} size="small" color="primary">
      Recalculate
    </Button>
  );
};

const SensorCalibrationList = () => (
  <List>
    <Datagrid rowClick="edit">
      <ReferenceField source="sensor_id" reference="sensors" link="show">
        <TextField source="serial_number" />
      </ReferenceField>
      <NumberField source="slope" />
      <NumberField source="intercept" />
      <DateField source="valid_from" showTime />
      <TextField source="performed_by" />
      <TextField source="notes" />
      <DateField source="created_at" showTime />
      <RecalculateButton />
    </Datagrid>
  </List>
);

const SensorCalibrationCreate = () => (
  <Create>
    <SimpleForm>
      <ReferenceInput source="sensor_id" reference="sensors">
        <SelectInput optionText="serial_number" />
      </ReferenceInput>
      <NumberInput source="slope" isRequired />
      <NumberInput source="intercept" isRequired />
      <DateTimeInput source="valid_from" isRequired />
      <TextInput source="performed_by" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Create>
);

const SensorCalibrationEdit = () => (
  <Edit>
    <SimpleForm>
      <ReferenceInput source="sensor_id" reference="sensors">
        <SelectInput optionText="serial_number" />
      </ReferenceInput>
      <NumberInput source="slope" isRequired />
      <NumberInput source="intercept" isRequired />
      <DateTimeInput source="valid_from" isRequired />
      <TextInput source="performed_by" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: SensorCalibrationList,
  create: SensorCalibrationCreate,
  edit: SensorCalibrationEdit,
};
