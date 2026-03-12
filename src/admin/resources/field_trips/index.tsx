import {
    List,
    Datagrid,
    TextField,
    DateField,
    Show,
    SimpleShowLayout,
    EditButton,
    Edit,
    SimpleForm,
    TextInput,
    DateInput,
} from 'react-admin';

export const FieldTripList = () => (
    <List sort={{ field: 'date', order: 'DESC' }}>
        <Datagrid rowClick="show">
            <DateField source="date" />
            <TextField source="participants" />
            <TextField source="notes" emptyText="-" />
            <TextField source="created_by" label="Created by" />
            <DateField source="created_at" showTime />
            <EditButton />
        </Datagrid>
    </List>
);

export const FieldTripShow = () => (
    <Show>
        <SimpleShowLayout>
            <DateField source="date" />
            <TextField source="participants" />
            <TextField source="notes" />
            <TextField source="created_by" label="Created by" />
            <DateField source="created_at" showTime />
        </SimpleShowLayout>
    </Show>
);

export const FieldTripEdit = () => (
    <Edit>
        <SimpleForm>
            <DateInput source="date" />
            <TextInput source="participants" />
            <TextInput source="notes" multiline rows={3} />
        </SimpleForm>
    </Edit>
);

export { FieldTripPage as FieldTripWizard } from './FieldTripWizard';

export default {
    list: FieldTripList,
    show: FieldTripShow,
    edit: FieldTripEdit,
};
