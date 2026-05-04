import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  DateField,
  FunctionField,
  Create,
  Edit,
  Show,
  SimpleShowLayout,
  SimpleForm,
  TextInput,
  NumberInput,
  ReferenceInput,
  SelectInput,
  DateTimeInput,
  TopToolbar,
  EditButton,
  useNotify,
  useRefresh,
  useRecordContext,
} from 'react-admin';
import { Button } from '@mui/material';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import { ConfirmPopover } from '../../components/ConfirmPopover';

const RecalculateButton = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  if (!record) return null;

  const handleConfirm = async () => {
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
    <ConfirmPopover
      title="Recalculate readings?"
      description="This will recompute all readings against this calibration. The previous calibrated values will be overwritten and cannot be undone."
      confirmLabel="Recalculate"
      confirmColor="warning"
      onConfirm={handleConfirm}
      trigger={
        <Button color="primary">
          Recalculate
        </Button>
      }
    />
  );
};

const SensorCalibrationList = () => (
  <List sort={{ field: 'valid_from', order: 'DESC' }}>
    <Datagrid rowClick="show">
      <ReferenceField source="sensor_id" reference="sensors" link="show">
        <TextField source="serial_number" />
      </ReferenceField>
      <NumberField source="slope" />
      <NumberField source="intercept" />
      <FunctionField
        label="Equation"
        render={(record: { slope: number; intercept: number }) =>
          `y = ${record.slope}x + ${record.intercept}`
        }
      />
      <DateField source="valid_from" showTime />
      <TextField source="performed_by" />
      <TextField source="notes" />
      <DateField source="created_at" showTime />
      <RecalculateButton />
    </Datagrid>
  </List>
);

const SensorCalibrationShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <ReferenceField source="sensor_id" reference="sensors" link="show">
        <TextField source="serial_number" />
      </ReferenceField>
      <NumberField source="slope" />
      <NumberField source="intercept" />
      <FunctionField
        label="Equation"
        render={(record: { slope: number; intercept: number }) =>
          `y = ${record.slope}x + ${record.intercept}`
        }
      />
      <DateField source="valid_from" showTime />
      <TextField source="performed_by" />
      <TextField source="notes" />
      <DateField source="created_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const SensorCalibrationCreate = () => (
  <Create>
    <SimpleForm>
      <ReferenceInput source="sensor_id" reference="sensors">
        <SelectInput optionText="serial_number" />
      </ReferenceInput>
      <NumberInput source="slope" isRequired helperText="Multiplier (1.0 = pass-through)" />
      <NumberInput source="intercept" isRequired helperText="Offset (0.0 = none)" />
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
  show: SensorCalibrationShow,
  create: SensorCalibrationCreate,
  edit: SensorCalibrationEdit,
};
