import LocationOnIcon from '@mui/icons-material/LocationOn';
import MemoryIcon from '@mui/icons-material/Memory';
import FunctionsIcon from '@mui/icons-material/Functions';
import ScienceIcon from '@mui/icons-material/Science';
import FolderIcon from '@mui/icons-material/Folder';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import PeopleIcon from '@mui/icons-material/People';

import projects from './projects';
import sites from './sites';
import parameters from './parameters';
import siteParameters from './site_parameters';
import sensors from './sensors';
import sensorCalibrations from './sensor_calibrations';
import sensorDeployments from './sensor_deployments';
import derivedParameters from './derived_parameters';
import alarmThresholds from './alarm_thresholds';
import tokens from './tokens';
import syncStatus from './sync_status';
import publicExposedParameters from './public_exposed_parameters';
import standardCurves from './standard_curves';
import users from './users';
import fieldTrips from './field_trips';

/** Resources shown in the sidebar navigation */
export const resources = [
  { name: 'sites', icon: LocationOnIcon, ...sites, options: { label: 'Stations' } },
  { name: 'sensors', icon: MemoryIcon, ...sensors, options: { label: 'Sensors' } },
  { name: 'parameters', icon: ScienceIcon, ...parameters, options: { label: 'Parameters' } },
  { name: 'derived_parameters', icon: FunctionsIcon, ...derivedParameters, options: { label: 'Derived Formulas' } },
  { name: 'standard_curves', icon: ShowChartIcon, ...standardCurves, options: { label: 'Standard Curves' } },
  { name: 'projects', icon: FolderIcon, ...projects, options: { label: 'Projects' } },
  { name: 'users', icon: PeopleIcon, ...users, options: { label: 'Users' } },
];

/** Resources hidden from sidebar but registered for reference resolution and CRUD routes */
export const hiddenResources = [
  { name: 'site_parameters', ...siteParameters },
  { name: 'tokens', ...tokens },
  { name: 'sync_status', ...syncStatus },
  { name: 'alarm_thresholds', ...alarmThresholds },
  { name: 'sensor_calibrations', ...sensorCalibrations },
  { name: 'sensor_deployments', ...sensorDeployments },
  { name: 'public_exposed_parameters', ...publicExposedParameters },
  { name: 'field_trips', ...fieldTrips },
];
