import {
  List,
  Datagrid,
  NumberField,
  ReferenceField,
  TextField,
  DateField,
  Edit,
  SimpleForm,
  NumberInput,
  TextInput,
} from 'react-admin';

const AlarmThresholdList = () => (
  <List perPage={50}>
    <Datagrid rowClick="edit">
      <ReferenceField source="parameter_id" reference="parameters" link="show" emptyText="-">
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

const AlarmThresholdEdit = () => (
  <Edit>
    <SimpleForm>
      <ReferenceField source="parameter_id" reference="parameters" link="show">
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
  edit: AlarmThresholdEdit,
};
