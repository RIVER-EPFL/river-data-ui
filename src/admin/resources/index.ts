import AccountTreeIcon from '@mui/icons-material/AccountTree';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import CategoryIcon from '@mui/icons-material/Category';
import SensorsIcon from '@mui/icons-material/Sensors';
import MemoryIcon from '@mui/icons-material/Memory';
import TuneIcon from '@mui/icons-material/Tune';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import FunctionsIcon from '@mui/icons-material/Functions';
import NotificationsIcon from '@mui/icons-material/Notifications';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SyncIcon from '@mui/icons-material/Sync';

import projects from './projects';
import sites from './sites';
import parameterTypes from './parameter_types';
import parameters from './parameters';
import sensors from './sensors';
import sensorCalibrations from './sensor_calibrations';
import sensorDeployments from './sensor_deployments';
import derivedParameters from './derived_parameters';
import alarmThresholds from './alarm_thresholds';
import tokens from './tokens';
import dataImports from './data_imports';
import syncStatus from './sync_status';

export const resources = [
  { name: 'projects', icon: AccountTreeIcon, ...projects, options: { label: 'Projects' } },
  { name: 'sites', icon: LocationOnIcon, ...sites, options: { label: 'Sites' } },
  { name: 'parameter_types', icon: CategoryIcon, ...parameterTypes, options: { label: 'Param Types' } },
  { name: 'parameters', icon: SensorsIcon, ...parameters, options: { label: 'Parameters' } },
  { name: 'sensors', icon: MemoryIcon, ...sensors, options: { label: 'Sensors' } },
  { name: 'sensor_calibrations', icon: TuneIcon, ...sensorCalibrations, options: { label: 'Calibrations' } },
  { name: 'sensor_deployments', icon: SwapHorizIcon, ...sensorDeployments, options: { label: 'Deployments' } },
  { name: 'derived_parameters', icon: FunctionsIcon, ...derivedParameters, options: { label: 'Derived Params' } },
  { name: 'alarm_thresholds', icon: NotificationsIcon, ...alarmThresholds, options: { label: 'Alarms' } },
  { name: 'tokens', icon: VpnKeyIcon, ...tokens, options: { label: 'API Tokens' } },
  { name: 'data_imports', icon: CloudUploadIcon, ...dataImports, options: { label: 'Imports' } },
  { name: 'sync_status', icon: SyncIcon, ...syncStatus, options: { label: 'Sync Status' } },
];
