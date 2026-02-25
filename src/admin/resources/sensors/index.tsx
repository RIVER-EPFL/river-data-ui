import { useState } from 'react';
import {
  List,
  Datagrid,
  TextField,
  NumberField,
  BooleanField,
  DateField,
  ReferenceField,
  FunctionField,
  Show,
  TabbedShowLayout,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  BooleanInput,
  ReferenceInput,
  SelectInput,
  ReferenceManyField,
  TopToolbar,
  EditButton,
  useNotify,
  useRefresh,
  useRecordContext,
  useCreate,
  useUpdate,
} from 'react-admin';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField as MuiTextField,
} from '@mui/material';
import { useRiverDataProvider } from '../../useRiverDataProvider';

// Item 4: Recalculate button per calibration row
const RecalibrateButton = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!record) return;
    try {
      await dataProvider.recalibrateCalibration(record.id as string);
      notify('Recalculation triggered', { type: 'success' });
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

// Item 5: Deploy button — opens dialog to create a new deployment
const DeployButton = ({ sensorId }: { sensorId: string }) => {
  const [open, setOpen] = useState(false);
  const [parameterId, setParameterId] = useState('');
  const [deployedFrom, setDeployedFrom] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [deploymentType, setDeploymentType] = useState('');
  const [notes, setNotes] = useState('');
  const [create, { isLoading }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();

  const handleSubmit = () => {
    create(
      'sensor_deployments',
      {
        data: {
          sensor_id: sensorId,
          parameter_id: parameterId,
          deployed_from: new Date(deployedFrom).toISOString(),
          deployment_type: deploymentType || null,
          notes: notes || null,
        },
      },
      {
        onSuccess: () => {
          notify('Deployment created', { type: 'success' });
          refresh();
          handleClose();
        },
        onError: () => {
          notify('Failed to create deployment', { type: 'error' });
        },
      }
    );
  };

  const handleClose = () => {
    setOpen(false);
    setParameterId('');
    setDeployedFrom(new Date().toISOString().slice(0, 16));
    setDeploymentType('');
    setNotes('');
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="small" color="primary" variant="outlined">
        Deploy
      </Button>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>New Deployment</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <ReferenceInput source="parameter_id" reference="parameters">
            <SelectInput
              optionText="name"
              value={parameterId}
              onChange={(e) => setParameterId(e.target.value as string)}
              fullWidth
              label="Parameter"
            />
          </ReferenceInput>
          <MuiTextField
            label="Deployed From"
            type="datetime-local"
            value={deployedFrom}
            onChange={(e) => setDeployedFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <MuiTextField
            label="Deployment Type"
            value={deploymentType}
            onChange={(e) => setDeploymentType(e.target.value)}
            fullWidth
          />
          <MuiTextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !parameterId} variant="contained">
            Deploy
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

// Item 5: Recall button — ends an active deployment
const RecallButton = () => {
  const record = useRecordContext();
  const [update, { isLoading }] = useUpdate();
  const notify = useNotify();
  const refresh = useRefresh();

  if (!record || record.deployed_until) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Recall this sensor? This will end the active deployment.')) return;
    update(
      'sensor_deployments',
      {
        id: record.id,
        data: { deployed_until: new Date().toISOString() },
        previousData: record,
      },
      {
        onSuccess: () => {
          notify('Sensor recalled', { type: 'success' });
          refresh();
        },
        onError: () => {
          notify('Recall failed', { type: 'error' });
        },
      }
    );
  };

  return (
    <Button onClick={handleClick} size="small" color="warning" disabled={isLoading}>
      Recall
    </Button>
  );
};

const SensorList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="serial_number" />
      <TextField source="name" />
      <ReferenceField source="parameter_type_id" reference="parameter_types" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <TextField source="manufacturer" />
      <TextField source="model" />
      <BooleanField source="is_active" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const DeploymentsTab = () => {
  const record = useRecordContext();
  if (!record) return null;
  return (
    <>
      <DeployButton sensorId={record.id as string} />
      <ReferenceManyField reference="sensor_deployments" target="sensor_id"
        sort={{ field: 'deployed_from', order: 'DESC' }} label={false}>
        <Datagrid bulkActionButtons={false}>
          <ReferenceField source="parameter_id" reference="parameters" link="show">
            <TextField source="name" />
          </ReferenceField>
          <DateField source="deployed_from" showTime />
          <DateField source="deployed_until" showTime emptyText="Active" />
          <TextField source="deployment_type" />
          <TextField source="notes" />
          <RecallButton />
        </Datagrid>
      </ReferenceManyField>
    </>
  );
};

const SensorShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <TabbedShowLayout>
      <TabbedShowLayout.Tab label="Overview">
        <TextField source="serial_number" emptyText="N/A" />
        <TextField source="name" />
        <ReferenceField source="parameter_type_id" reference="parameter_types" link={false}>
          <TextField source="display_name" />
        </ReferenceField>
        <TextField source="manufacturer" />
        <TextField source="model" />
        <BooleanField source="is_active" />
        <TextField source="notes" />
        <DateField source="created_at" showTime />
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Deployments">
        <DeploymentsTab />
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Calibrations">
        <ReferenceManyField reference="sensor_calibrations" target="sensor_id"
          sort={{ field: 'valid_from', order: 'DESC' }} label={false}>
          <Datagrid bulkActionButtons={false}>
            <NumberField source="slope" />
            <NumberField source="intercept" />
            <FunctionField label="Equation" render={(record: { slope: number; intercept: number }) =>
              `y = ${record.slope}x + ${record.intercept}`
            } />
            <DateField source="valid_from" showTime />
            <TextField source="performed_by" />
            <TextField source="notes" />
            <RecalibrateButton />
          </Datagrid>
        </ReferenceManyField>
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  </Show>
);

const SensorCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="serial_number" isRequired />
      <TextInput source="name" />
      <ReferenceInput source="parameter_type_id" reference="parameter_types">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="manufacturer" />
      <TextInput source="model" />
      <BooleanInput source="is_active" defaultValue={true} />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Create>
);

const SensorEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="serial_number" isRequired />
      <TextInput source="name" />
      <ReferenceInput source="parameter_type_id" reference="parameter_types">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="manufacturer" />
      <TextInput source="model" />
      <BooleanInput source="is_active" />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: SensorList,
  show: SensorShow,
  create: SensorCreate,
  edit: SensorEdit,
};
