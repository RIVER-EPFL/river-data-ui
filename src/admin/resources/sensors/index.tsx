import { useState, useEffect, useMemo } from 'react';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
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
  useListContext,
  Labeled,
} from 'react-admin';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField as MuiTextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import { ConfirmPopover } from '../../components/ConfirmPopover';
import { RecallPopover } from './RecallPopover';
import { SensorStatusPin, type SensorStatus } from './SensorStatusPin';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import UndoIcon from '@mui/icons-material/Undo';
import TuneIcon from '@mui/icons-material/Tune';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { IconButton } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

// Item 4: Recalculate button per calibration row
const RecalibrateButton = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  if (!record) return null;

  const handleConfirm = async () => {
    try {
      await dataProvider.recalibrateCalibration(record.id as string);
      notify('Recalculation triggered', { type: 'success' });
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


const calAgeDays = (calDate: string | null | undefined): number | null => {
  if (!calDate) return null;
  return Math.floor((Date.now() - new Date(calDate).getTime()) / 86400000);
};

const calAgeColor = (days: number | null): 'success' | 'warning' | 'error' | 'default' => {
  if (days == null) return 'default';
  if (days < 30) return 'success';
  if (days <= 90) return 'warning';
  return 'error';
};

// Filters for the sensor list
const sensorFilters = [
  <ReferenceInput source="parameter_id" reference="parameters" key="parameter_type" alwaysOn>
    <SelectInput optionText="display_name" label="Parameter Type" />
  </ReferenceInput>,
  <NullableBooleanInput source="is_active" label="Active" key="is_active" alwaysOn />,
  <NullableBooleanInput source="is_lab_instrument" label="Lab Instrument" key="is_lab_instrument" />,
];

interface SensorListRecord {
  id: string;
  serial_number: string | null;
  name: string | null;
  parameter_id: string;
  manufacturer: string | null;
  is_active: boolean;
  is_lab_instrument: boolean;
  current_site_id: string | null;
  current_site_name: string | null;
  last_reading_at: string | null;
  last_reading_value: number | null;
  last_calibration_at: string | null;
}

const FilteredSensorDatagrid = ({
  showUndeployed,
  showNeedsCalibration,
}: {
  showUndeployed: boolean | null;
  showNeedsCalibration: boolean | null;
}) => {
  const { data: allSensors } = useListContext<SensorListRecord>();

  const filteredIds = useMemo(() => {
    if (!allSensors) return new Set<string>();
    let sensors = allSensors;
    if (showUndeployed === true) {
      sensors = sensors.filter((s) => !s.current_site_id);
    } else if (showUndeployed === false) {
      sensors = sensors.filter((s) => !!s.current_site_id);
    }
    if (showNeedsCalibration === true) {
      sensors = sensors.filter((s) => {
        const days = calAgeDays(s.last_calibration_at);
        return days == null || days > 90;
      });
    } else if (showNeedsCalibration === false) {
      sensors = sensors.filter((s) => {
        const days = calAgeDays(s.last_calibration_at);
        return days != null && days <= 90;
      });
    }
    return new Set(sensors.map((s) => s.id));
  }, [allSensors, showUndeployed, showNeedsCalibration]);

  return (
    <Datagrid
      rowClick="show"
      rowSx={(record) => ({
        display: filteredIds.has(record.id as string) ? undefined : 'none',
      })}
    >
      <FunctionField
        label=""
        render={(record: SensorListRecord) => {
          let status: SensorStatus = 'unknown';
          if (record.is_lab_instrument) status = 'healthy';
          else if (!record.current_site_id) status = 'undeployed';
          else if (calAgeDays(record.last_calibration_at) == null || (calAgeDays(record.last_calibration_at) ?? 0) > 90) status = 'attention';
          else status = 'healthy';
          return <SensorStatusPin status={status} />;
        }}
      />
      <TextField source="serial_number" />
      <TextField source="name" />
      <ReferenceField source="parameter_id" reference="parameters" link={false}>
        <TextField source="display_name" />
      </ReferenceField>
      <FunctionField
        label="Deployed At"
        render={(record: SensorListRecord) =>
          record.current_site_name ? (
            <Button
              component={RouterLink}
              to={`/admin/sites/${record.current_site_id}/show`}
              sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
            >
              {record.current_site_name}
            </Button>
          ) : (
            <Typography variant="body2" color="text.disabled">Not deployed</Typography>
          )
        }
      />
      <FunctionField
        label="Last Reading"
        render={(record: SensorListRecord) =>
          record.last_reading_at ? (
            <Typography variant="body2">
              {record.last_reading_value?.toFixed(2) ?? '—'}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                {formatRelativeTime(record.last_reading_at)}
              </Typography>
            </Typography>
          ) : (
            <Typography variant="body2" color="text.disabled">No data</Typography>
          )
        }
      />
      <FunctionField
        label="Cal. Age"
        render={(record: SensorListRecord) => {
          const days = calAgeDays(record.last_calibration_at);
          if (days == null) return <Typography variant="body2" color="text.disabled">Never</Typography>;
          return (
            <Tooltip title={`Last calibrated: ${new Date(record.last_calibration_at!).toLocaleDateString()}`}>
              <Chip label={`${days}d`} color={calAgeColor(days)} variant="outlined" />
            </Tooltip>
          );
        }}
      />
      <TextField source="manufacturer" />
      <BooleanField source="is_active" />
      <BooleanField source="is_lab_instrument" label="Lab" />
      <FunctionField
        label="Actions"
        render={(record: SensorListRecord) => (
          <Box sx={{ display: 'flex', gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
            <SensorRowActions sensorId={record.id} undeployed={!record.current_site_id} />
          </Box>
        )}
      />
    </Datagrid>
  );
};

/** Compact icon row actions for the sensor list. */
const SensorRowActions = ({ sensorId, undeployed }: { sensorId: string; undeployed: boolean }) => {
  // Find active deployment id for the recall popover
  const { data: deployments } = useGetList(
    'sensor_deployments',
    {
      filter: { sensor_id: sensorId, deployed_until: null },
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'deployed_from', order: 'DESC' },
    },
  );
  const activeDeployment = deployments?.[0];

  return (
    <>
      <Tooltip title={undeployed ? 'Deploy sensor' : 'Move sensor'}>
        <IconButton
          component={RouterLink}
          to={`/admin/sensors/${sensorId}/move`}
        >
          {undeployed ? (
            <CloudUploadIcon fontSize="small" />
          ) : (
            <SwapHorizIcon fontSize="small" />
          )}
        </IconButton>
      </Tooltip>
      {activeDeployment ? (
        <RecallPopover
          deploymentId={activeDeployment.id as string}
          existingNotes={activeDeployment.notes as string | null}
          trigger={
            <Tooltip title="Recall sensor">
              <IconButton color="warning">
                <HighlightOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        />
      ) : (
        <Tooltip title="No active deployment to recall">
          <span>
            <IconButton disabled color="warning">
              <HighlightOffIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <Tooltip title="Calibrate (open sensor)">
        <IconButton
          component={RouterLink}
          to={`/admin/sensors/${sensorId}/show/2`}
        >
          <TuneIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  );
};

const SensorList = () => {
  const [showUndeployed, setShowUndeployed] = useState<boolean | null>(null);
  const [showNeedsCalibration, setShowNeedsCalibration] = useState<boolean | null>(null);

  return (
    <List
      filters={sensorFilters}
      actions={
        <TopToolbar>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button
              variant={showUndeployed === true ? 'contained' : 'outlined'}
              onClick={() => setShowUndeployed(prev => prev === true ? null : true)}
              color={showUndeployed === true ? 'warning' : 'inherit'}
            >
              Undeployed
            </Button>
            <Button
              variant={showNeedsCalibration === true ? 'contained' : 'outlined'}
              onClick={() => setShowNeedsCalibration(prev => prev === true ? null : true)}
              color={showNeedsCalibration === true ? 'warning' : 'inherit'}
            >
              Needs Calibration
            </Button>
          </Box>
        </TopToolbar>
      }
    >
      <FilteredSensorDatagrid
        showUndeployed={showUndeployed}
        showNeedsCalibration={showNeedsCalibration}
      />
    </List>
  );
};

const RollbackButton = ({ deploymentId }: { deploymentId: string }) => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();
  return (
    <ConfirmPopover
      title="Rollback Deployment"
      description="This will delete this deployment, restore the previous one, and reassign any readings back to the original site."
      confirmLabel="Rollback"
      confirmColor="error"
      onConfirm={async () => {
        try {
          const { data } = await dataProvider.rollbackDeployment(deploymentId);
          notify(`Rolled back: ${data.readings_reassigned} readings reassigned`, { type: 'success' });
          refresh();
        } catch (e) {
          notify(`Rollback failed: ${e instanceof Error ? e.message : 'Unknown error'}`, { type: 'error' });
        }
      }}
      trigger={
        <Tooltip title="Rollback this deployment">
          <IconButton color="error">
            <UndoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    />
  );
};

const DeploymentsTab = () => {
  const record = useRecordContext();
  if (!record) return null;
  return (
    <>
      <Button
        component={RouterLink}
        to={`/admin/sensors/${record.id}/move`}
        startIcon={<CloudUploadIcon />}
        variant="contained"
        sx={{ mb: 2 }}
      >
        Deploy / Move
      </Button>
      <ReferenceManyField reference="sensor_deployments" target="sensor_id"
        sort={{ field: 'deployed_from', order: 'DESC' }} label={false}>
        <Datagrid bulkActionButtons={false} rowClick="edit">
          <ReferenceField source="site_id" reference="sites" link="show">
            <TextField source="name" />
          </ReferenceField>
          <DateField source="deployed_from" showTime />
          <DateField source="deployed_until" showTime emptyText="Active" />
          <TextField source="deployment_type" />
          <TextField source="notes" />
          <FunctionField
            label=""
            render={(d: { id: string; deployed_until: string | null; notes: string | null }) => (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {d.deployed_until === null ? (
                  <RecallPopover
                    deploymentId={d.id}
                    existingNotes={d.notes}
                    trigger={
                      <Tooltip title="Recall this deployment">
                        <IconButton color="warning">
                          <HighlightOffIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    }
                  />
                ) : null}
                <RollbackButton deploymentId={d.id} />
              </Box>
            )}
          />
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
        <ReferenceField source="parameter_id" reference="parameters" link={false}>
          <TextField source="display_name" />
        </ReferenceField>
        <TextField source="manufacturer" />
        <TextField source="model" />
        <BooleanField source="is_active" />
        <BooleanField source="is_lab_instrument" label="Lab Instrument" />
        <TextField source="notes" />
        <DateField source="created_at" showTime />
        <FunctionField
          label="Current Site"
          render={(record: { current_site_id?: string; current_site_name?: string }) =>
            record.current_site_name ? (
              <Button
                component={RouterLink}
                to={`/admin/sites/${record.current_site_id}/show`}
                sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
              >
                {record.current_site_name}
              </Button>
            ) : (
              <Typography variant="body2" color="text.disabled">Not deployed</Typography>
            )
          }
        />
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
      <ReferenceInput source="parameter_id" reference="parameters">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="manufacturer" />
      <TextInput source="model" />
      <BooleanInput source="is_active" defaultValue={true} />
      <BooleanInput source="is_lab_instrument" label="Lab Instrument" defaultValue={false} />
      <TextInput source="notes" multiline />
    </SimpleForm>
  </Create>
);

const SensorEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="serial_number" isRequired />
      <TextInput source="name" />
      <ReferenceInput source="parameter_id" reference="parameters">
        <SelectInput optionText="display_name" />
      </ReferenceInput>
      <TextInput source="manufacturer" />
      <TextInput source="model" />
      <BooleanInput source="is_active" />
      <BooleanInput source="is_lab_instrument" label="Lab Instrument" />
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
