import {
  List,
  Datagrid,
  NumberField,
  ReferenceField,
  TextField,
  DateField,
  FunctionField,
  Edit,
  Show,
  SimpleShowLayout,
  SimpleForm,
  NumberInput,
  TextInput,
  TopToolbar,
  EditButton,
} from 'react-admin';
import { Box, Chip, Typography } from '@mui/material';

/**
 * Scope indicator: shows whether a threshold is parameter-default or
 * site-specific override. Site-specific thresholds take precedence at
 * read time.
 */
const ThresholdScope = ({ siteId }: { siteId: string | null }) =>
  siteId ? (
    <Chip label="Site-specific override" color="primary" variant="outlined" />
  ) : (
    <Chip label="Parameter default" color="default" variant="outlined" />
  );

const AlarmThresholdList = () => (
  <List perPage={50} sort={{ field: 'updated_at', order: 'DESC' }}>
    <Datagrid rowClick="show">
      <ReferenceField source="parameter_id" reference="parameters" link="show" emptyText="-">
        <TextField source="name" />
      </ReferenceField>
      <FunctionField
        label="Scope"
        render={(r: { site_id: string | null }) => <ThresholdScope siteId={r.site_id} />}
      />
      <ReferenceField source="site_id" reference="sites" link="show" emptyText="—">
        <TextField source="name" />
      </ReferenceField>
      <NumberField source="warning_min" />
      <NumberField source="warning_max" />
      <NumberField source="alarm_min" />
      <NumberField source="alarm_max" />
      <TextField source="description" />
      <DateField source="updated_at" showTime />
    </Datagrid>
  </List>
);

const AlarmThresholdShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <FunctionField
        label="Scope"
        render={(r: { site_id: string | null }) => (
          <Box>
            <ThresholdScope siteId={r.site_id} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Site-specific overrides take precedence over parameter defaults.
            </Typography>
          </Box>
        )}
      />
      <ReferenceField source="parameter_id" reference="parameters" link="show">
        <TextField source="name" />
      </ReferenceField>
      <ReferenceField source="site_id" reference="sites" link="show" emptyText="(global default)">
        <TextField source="name" />
      </ReferenceField>
      <NumberField source="warning_min" />
      <NumberField source="warning_max" />
      <NumberField source="alarm_min" />
      <NumberField source="alarm_max" />
      <TextField source="description" />
      <DateField source="updated_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const AlarmThresholdEdit = () => (
  <Edit>
    <SimpleForm>
      <FunctionField
        label="Scope"
        render={(r: Record<string, unknown>) =>
          <ThresholdScope siteId={(r.site_id ?? null) as string | null} />
        }
      />
      <ReferenceField source="parameter_id" reference="parameters" link="show">
        <TextField source="name" />
      </ReferenceField>
      <ReferenceField source="site_id" reference="sites" link="show" emptyText="(global default)">
        <TextField source="name" />
      </ReferenceField>
      <NumberInput source="warning_min" />
      <NumberInput source="warning_max" />
      <NumberInput source="alarm_min" />
      <NumberInput source="alarm_max" />
      <TextInput source="description" multiline />
    </SimpleForm>
  </Edit>
);

export default {
  list: AlarmThresholdList,
  show: AlarmThresholdShow,
  edit: AlarmThresholdEdit,
};
