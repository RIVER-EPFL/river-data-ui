import { useState, useEffect } from 'react';
import { useKeycloak } from '../../KeycloakContext';
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
  NullableBooleanInput,
  ReferenceManyField,
  TopToolbar,
  EditButton,
  useNotify,
  useRefresh,
  useRecordContext,
  useCreate,
  useUpdate,
  useGetList,
  useGetOne,
} from 'react-admin';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField as MuiTextField,
  Tooltip,
  Typography,
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
          <ReferenceInput source="parameter_id" reference="site_parameters">
            <SelectInput
              optionText="name"
              value={parameterId}
              onChange={(e) => setParameterId(e.target.value as string)}
              fullWidth
              label="Site Parameter"
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

// Recall button for the sensor list — finds the active deployment and ends it
const ListRecallButton = () => {
  const record = useRecordContext();
  const [update, { isLoading }] = useUpdate();
  const notify = useNotify();
  const refresh = useRefresh();

  const { data: deployments } = useGetList('sensor_deployments', {
    filter: record ? { sensor_id: record.id } : {},
    sort: { field: 'deployed_from', order: 'DESC' },
    pagination: { page: 1, perPage: 10 },
  }, { enabled: !!record });

  const active = deployments?.find((d: { deployed_until: string | null }) => !d.deployed_until);

  if (!record || !active) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Recall this sensor? This will end the active deployment.')) return;
    update(
      'sensor_deployments',
      {
        id: active.id,
        data: { deployed_until: new Date().toISOString() },
        previousData: active,
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
    <Button onClick={handleClick} size="small" color="warning" variant="outlined" disabled={isLoading}>
      Recall
    </Button>
  );
};

// Show current deployment site inline
const DeployedAtField = () => {
  const record = useRecordContext();
  const { data: deployments } = useGetList('sensor_deployments', {
    filter: record ? { sensor_id: record.id } : {},
    sort: { field: 'deployed_from', order: 'DESC' },
    pagination: { page: 1, perPage: 1 },
  }, { enabled: !!record });

  const active = deployments?.find((d: { deployed_until: string | null }) => !d.deployed_until);
  if (!active) return <Typography variant="body2" color="text.disabled">Not deployed</Typography>;

  return (
    <ReferenceField source="parameter_id" reference="site_parameters" record={active} link={false}>
      <ReferenceField source="site_id" reference="sites" link="show">
        <TextField source="name" />
      </ReferenceField>
    </ReferenceField>
  );
};

// Format a timestamp as relative time (e.g., "2h ago", "3d ago")
const formatRelativeTime = (isoTime: string): string => {
  const diff = Date.now() - new Date(isoTime).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

interface ReadingsApiResponse {
  times: string[];
  parameters: Array<{
    id: string;
    name: string;
    type: string;
    units: string | null;
    values: Array<number | null>;
  }>;
}

// Show the latest reading value + relative time for a sensor
const LastReadingField = (_props: { label?: string }) => {
  const record = useRecordContext();
  const [lastReading, setLastReading] = useState<{ value: number; time: string; units: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const keycloak = useKeycloak();

  // Step 1: Find the sensor's active deployment
  const { data: deployments } = useGetList('sensor_deployments', {
    filter: record ? { sensor_id: record.id } : {},
    sort: { field: 'deployed_from', order: 'DESC' },
    pagination: { page: 1, perPage: 1 },
  }, { enabled: !!record });

  const active = deployments?.find((d: { deployed_until: string | null }) => !d.deployed_until);

  // Step 2: Get the site_parameter to find site_id
  const { data: siteParam } = useGetOne('site_parameters', {
    id: active?.parameter_id,
  }, { enabled: !!active?.parameter_id });

  // Step 3: Fetch latest reading from the readings API
  useEffect(() => {
    if (!siteParam?.site_id || !active?.parameter_id) {
      setLastReading(null);
      return;
    }

    setLoading(true);
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const url = `/api/service/sites/${siteParam.site_id}/readings?start=${start.toISOString()}&page_size=1000&format=json`;
    const headers: HeadersInit = keycloak?.token ? { 'Authorization': 'Bearer ' + keycloak.token } : {};

    fetch(url, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ReadingsApiResponse>;
      })
      .then((data) => {
        if (data.times?.length && data.parameters?.length) {
          const param = data.parameters.find((p) => p.id === active.parameter_id);
          if (param) {
            // Walk backwards to find latest non-null value
            for (let i = data.times.length - 1; i >= 0; i--) {
              const val = param.values[i];
              if (val != null) {
                setLastReading({ value: val, time: data.times[i], units: param.units });
                return;
              }
            }
          }
        }
        setLastReading(null);
      })
      .catch((err) => {
        console.error('Failed to fetch latest reading:', err);
        setLastReading(null);
      })
      .finally(() => setLoading(false));
  }, [siteParam?.site_id, active?.parameter_id]);

  if (!record) return null;
  if (!active) return <Typography variant="body2" color="text.disabled">&mdash;</Typography>;
  if (loading) return <Typography variant="body2" color="text.secondary">...</Typography>;
  if (!lastReading) return <Typography variant="body2" color="text.disabled">No data</Typography>;

  const displayValue = lastReading.units
    ? `${lastReading.value} ${lastReading.units}`
    : `${lastReading.value}`;

  return (
    <Typography variant="body2">
      {displayValue}{' '}
      <Typography component="span" variant="caption" color="text.secondary">
        {formatRelativeTime(lastReading.time)}
      </Typography>
    </Typography>
  );
};

// Battery status field — finds the Battery parameter at the sensor's deployed site
// and shows the latest voltage reading as a colored chip
const BatteryStatusField = (_props: { label?: string }) => {
  const record = useRecordContext();
  const [batteryValue, setBatteryValue] = useState<{ voltage: number; time: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const keycloak = useKeycloak();

  // Step 1: Find the sensor's active deployment
  const { data: deployments } = useGetList('sensor_deployments', {
    filter: record ? { sensor_id: record.id } : {},
    sort: { field: 'deployed_from', order: 'DESC' },
    pagination: { page: 1, perPage: 1 },
  }, { enabled: !!record });

  const active = deployments?.find((d: { deployed_until: string | null }) => !d.deployed_until);

  // Step 2: Get the site_parameter to find site_id
  const { data: siteParam } = useGetOne('site_parameters', {
    id: active?.parameter_id,
  }, { enabled: !!active?.parameter_id });

  // Step 3: Find the Battery-type site_parameter at the same site
  const { data: batteryParams } = useGetList('site_parameters', {
    filter: siteParam?.site_id ? { site_id: siteParam.site_id } : {},
    sort: { field: 'name', order: 'ASC' },
    pagination: { page: 1, perPage: 100 },
  }, { enabled: !!siteParam?.site_id });

  const batteryParam = batteryParams?.find(
    (p: { name: string }) => /batt/i.test(p.name)
  );

  // Step 4: Fetch latest reading for the Battery parameter
  useEffect(() => {
    if (!siteParam?.site_id || !batteryParam?.id) {
      setBatteryValue(null);
      return;
    }

    setLoading(true);
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const url = `/api/service/sites/${siteParam.site_id}/readings?start=${start.toISOString()}&parameter_ids=${batteryParam.id}&page_size=1000&format=json`;
    const headers: HeadersInit = keycloak?.token ? { 'Authorization': 'Bearer ' + keycloak.token } : {};

    fetch(url, { headers })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ReadingsApiResponse>;
      })
      .then((data) => {
        if (data.times?.length && data.parameters?.length) {
          const param = data.parameters.find((p) => p.id === batteryParam.id);
          if (param) {
            for (let i = data.times.length - 1; i >= 0; i--) {
              const val = param.values[i];
              if (val != null) {
                setBatteryValue({ voltage: val, time: data.times[i] });
                return;
              }
            }
          }
        }
        setBatteryValue(null);
      })
      .catch((err) => {
        console.error('Failed to fetch battery reading:', err);
        setBatteryValue(null);
      })
      .finally(() => setLoading(false));
  }, [siteParam?.site_id, batteryParam?.id]);

  if (!record) return null;
  if (!active) return <Typography variant="body2" color="text.disabled">&mdash;</Typography>;
  if (loading) return <Typography variant="body2" color="text.secondary">...</Typography>;
  if (!batteryValue) return <Typography variant="body2" color="text.disabled">N/A</Typography>;

  const { voltage } = batteryValue;
  let color: 'success' | 'warning' | 'error';
  if (voltage > 12.5) {
    color = 'success';
  } else if (voltage >= 12.1) {
    color = 'warning';
  } else {
    color = 'error';
  }

  return (
    <Tooltip title={`${formatRelativeTime(batteryValue.time)}`}>
      <Chip label={`${voltage.toFixed(1)} V`} size="small" color={color} variant="outlined" />
    </Tooltip>
  );
};

// Calibration age field — shows days since last calibration as a colored chip
const CalibrationAgeField = (_props: { label?: string }) => {
  const record = useRecordContext();

  const { data: calibrations, isLoading } = useGetList('sensor_calibrations', {
    filter: record ? { sensor_id: record.id } : {},
    sort: { field: 'valid_from', order: 'DESC' },
    pagination: { page: 1, perPage: 1 },
  }, { enabled: !!record });

  if (!record) return null;
  if (isLoading) return <Typography variant="body2" color="text.secondary">...</Typography>;

  const latest = calibrations?.[0];
  if (!latest) return <Typography variant="body2" color="text.disabled">Never</Typography>;

  const daysSince = Math.floor(
    (Date.now() - new Date(latest.valid_from).getTime()) / (1000 * 60 * 60 * 24)
  );

  let color: 'success' | 'warning' | 'error';
  if (daysSince < 30) {
    color = 'success';
  } else if (daysSince <= 90) {
    color = 'warning';
  } else {
    color = 'error';
  }

  return (
    <Tooltip title={`Last calibrated: ${new Date(latest.valid_from).toLocaleDateString()}`}>
      <Chip label={`${daysSince}d`} size="small" color={color} variant="outlined" />
    </Tooltip>
  );
};

// Filters for the sensor list
const sensorFilters = [
  <ReferenceInput source="parameter_type_id" reference="parameters" key="parameter_type" alwaysOn>
    <SelectInput optionText="display_name" label="Parameter Type" />
  </ReferenceInput>,
  <NullableBooleanInput source="is_active" label="Active" key="is_active" alwaysOn />,
  <NullableBooleanInput source="undeployed" label="Undeployed" key="undeployed" />,
  <NullableBooleanInput source="needs_calibration" label="Needs Calibration" key="needs_calibration" />,
];

const SensorList = () => (
  <List filters={sensorFilters}>
    <Datagrid rowClick="show">
      <TextField source="serial_number" />
      <TextField source="name" />
      <ReferenceField source="parameter_type_id" reference="parameters" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <FunctionField label="Deployed At" render={() => <DeployedAtField />} />
      <FunctionField label="Last Reading" render={() => <LastReadingField />} />
      <FunctionField label="Battery" render={() => <BatteryStatusField />} />
      <FunctionField label="Cal. Age" render={() => <CalibrationAgeField />} />
      <TextField source="manufacturer" />
      <TextField source="model" />
      <BooleanField source="is_active" />
      <DateField source="created_at" showTime />
      <FunctionField
        label="Actions"
        render={(record: { id: string }) => (
          <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <DeployButton sensorId={record.id} />
            <ListRecallButton />
          </Box>
        )}
      />
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
          <ReferenceField source="parameter_id" reference="site_parameters" link="show">
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
        <ReferenceField source="parameter_type_id" reference="parameters" link={false}>
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
      <ReferenceInput source="parameter_type_id" reference="parameters">
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
      <ReferenceInput source="parameter_type_id" reference="parameters">
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
