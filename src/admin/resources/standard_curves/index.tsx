import {
  List,
  Datagrid,
  TextField,
  NumberField,
  ReferenceField,
  DateField,
  FunctionField,
  Show,
  SimpleShowLayout,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  NumberInput,
  ReferenceInput,
  SelectInput,
  DateTimeInput,
  TopToolbar,
  EditButton,
} from 'react-admin';

const StandardCurveList = () => (
  <List sort={{ field: 'valid_from', order: 'DESC' }}>
    <Datagrid rowClick="show">
      <ReferenceField source="parameter_id" reference="site_parameters" link={false}>
        <TextField source="name" />
      </ReferenceField>
      <DateField source="valid_from" showTime />
      <NumberField source="slope" />
      <NumberField source="intercept" />
      <NumberField source="r_squared" options={{ maximumFractionDigits: 6 }} />
      <FunctionField
        label="Equation"
        render={(record: { slope: number; intercept: number }) =>
          `y = ${record.slope}x + ${record.intercept}`
        }
      />
      <TextField source="created_by" />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const StandardCurveShow = () => (
  <Show actions={<TopToolbar><EditButton /></TopToolbar>}>
    <SimpleShowLayout>
      <ReferenceField source="parameter_id" reference="site_parameters" link="show">
        <TextField source="name" />
      </ReferenceField>
      <DateField source="valid_from" showTime />
      <NumberField source="slope" />
      <NumberField source="intercept" />
      <FunctionField
        label="Equation"
        render={(record: { slope: number; intercept: number }) =>
          `y = ${record.slope}x + ${record.intercept}`
        }
      />
      <NumberField source="r_squared" options={{ maximumFractionDigits: 6 }} />
      <TextField source="notes" />
      <TextField source="created_by" />
      <DateField source="created_at" showTime />
    </SimpleShowLayout>
  </Show>
);

const StandardCurveCreate = () => (
  <Create>
    <SimpleForm>
      <ReferenceInput source="parameter_id" reference="site_parameters">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <DateTimeInput source="valid_from" isRequired />
      <NumberInput source="slope" isRequired />
      <NumberInput source="intercept" isRequired />
      <NumberInput source="r_squared" />
      <TextInput source="notes" multiline />
      <TextInput source="created_by" />
    </SimpleForm>
  </Create>
);

const StandardCurveEdit = () => (
  <Edit>
    <SimpleForm>
      <ReferenceInput source="parameter_id" reference="site_parameters">
        <SelectInput optionText="name" />
      </ReferenceInput>
      <DateTimeInput source="valid_from" isRequired />
      <NumberInput source="slope" isRequired />
      <NumberInput source="intercept" isRequired />
      <NumberInput source="r_squared" />
      <TextInput source="notes" multiline />
      <TextInput source="created_by" />
    </SimpleForm>
  </Edit>
);

export default {
  list: StandardCurveList,
  show: StandardCurveShow,
  create: StandardCurveCreate,
  edit: StandardCurveEdit,
};
