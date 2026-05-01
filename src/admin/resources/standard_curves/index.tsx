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
  useGetList,
} from 'react-admin';
import { Chip } from '@mui/material';
import { useMemo } from 'react';

/**
 * For a parameter, the "current" curve is the one with the latest valid_from
 * that is on or before now. The list groups by parameter_id; we compute
 * the current id per group and badge the matching row.
 */
const CurrentCurveBadge = ({
  parameterId,
  recordId,
  validFrom,
}: {
  parameterId: string;
  recordId: string;
  validFrom: string;
}) => {
  const { data: allCurves } = useGetList(
    'standard_curves',
    {
      filter: { parameter_id: parameterId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'valid_from', order: 'DESC' },
    },
  );

  const isCurrent = useMemo(() => {
    if (!allCurves) return false;
    const now = Date.now();
    const eligible = allCurves
      .filter((c) => new Date(c.valid_from as string).getTime() <= now)
      .sort(
        (a, b) =>
          new Date(b.valid_from as string).getTime() -
          new Date(a.valid_from as string).getTime(),
      );
    return eligible[0]?.id === recordId;
  }, [allCurves, recordId]);

  if (!isCurrent) {
    const isFuture = new Date(validFrom).getTime() > Date.now();
    return isFuture ? (
      <Chip label="Future" color="info" variant="outlined" />
    ) : (
      <Chip label="Historical" color="default" variant="outlined" />
    );
  }
  return <Chip label="Current" color="success" />;
};

const StandardCurveList = () => (
  <List sort={{ field: 'valid_from', order: 'DESC' }}>
    <Datagrid rowClick="show">
      <FunctionField
        label="Status"
        render={(r: { id: string; parameter_id: string; valid_from: string }) => (
          <CurrentCurveBadge
            parameterId={r.parameter_id}
            recordId={r.id}
            validFrom={r.valid_from}
          />
        )}
      />
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
