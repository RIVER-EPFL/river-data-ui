import { useState, useCallback } from 'react';
import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  BooleanInput,
  FunctionField,
  Show,
  SimpleShowLayout,
  Create,
  SimpleForm,
  TextInput,
  Edit,
  useRecordContext,
  useNotify,
} from 'react-admin';
import {
  Chip,
  Stack,
  Box,
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';
import { useRiverDataProvider } from '../../useRiverDataProvider';

// ---------- Helpers ----------

const RolesField = () => {
  const record = useRecordContext();
  if (!record?.roles || !Array.isArray(record.roles)) return null;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap">
      {(record.roles as string[]).map((role) => (
        <Chip key={role} label={role} size="small" />
      ))}
    </Stack>
  );
};

const hasAdmin = (roles?: unknown): boolean =>
  Array.isArray(roles) && (roles as string[]).includes('admin');

const AdminToggle = () => {
  const record = useRecordContext();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => hasAdmin(record?.roles));

  const handleToggle = useCallback(async () => {
    if (!record?.id) return;
    const newAdmin = !isAdmin;
    const newRoles = newAdmin ? ['admin', 'user'] : ['user'];
    setSaving(true);
    try {
      await dataProvider.assignUserRoles(record.id as string, newRoles);
      setIsAdmin(newAdmin);
      notify('Roles updated', { type: 'success' });
    } catch {
      notify('Failed to update roles', { type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [record?.id, isAdmin, dataProvider, notify]);

  if (!record) return null;

  return (
    <Box sx={{ py: 1 }}>
      <FormControlLabel
        control={
          saving ? (
            <CircularProgress size={20} sx={{ mx: 1.25 }} />
          ) : (
            <Switch checked={isAdmin} onChange={handleToggle} />
          )
        }
        label="Administrator"
      />
    </Box>
  );
};

// ---------- List ----------

const userFilters = [
  <BooleanInput key="admin" source="admin" label="Admins only" alwaysOn />,
];

const UserList = () => (
  <List sort={{ field: 'username', order: 'ASC' }} filters={userFilters}>
    <Datagrid rowClick="show">
      <TextField source="username" />
      <TextField source="email" />
      <TextField source="firstName" label="First Name" />
      <TextField source="lastName" label="Last Name" />
      <BooleanField source="enabled" />
      <FunctionField
        label="Admin"
        render={(record: { roles?: string[] }) => hasAdmin(record?.roles) ? '✓' : ''}
      />
      <FunctionField
        label="Created"
        render={(record: { createdTimestamp?: number }) =>
          record?.createdTimestamp
            ? new Date(record.createdTimestamp).toLocaleDateString()
            : ''
        }
      />
    </Datagrid>
  </List>
);

// ---------- Show ----------

const UserShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="username" />
      <TextField source="email" />
      <TextField source="firstName" label="First Name" />
      <TextField source="lastName" label="Last Name" />
      <BooleanField source="enabled" />
      <FunctionField label="Roles" render={() => <RolesField />} />
      <AdminToggle />
    </SimpleShowLayout>
  </Show>
);

// ---------- Create ----------

const UserCreate = () => (
  <Create redirect="show">
    <SimpleForm>
      <TextInput source="username" isRequired />
      <TextInput source="email" type="email" />
      <TextInput source="firstName" label="First Name" />
      <TextInput source="lastName" label="Last Name" />
      <TextInput source="password" type="password" helperText="Initial password for the user" />
      <BooleanInput source="enabled" defaultValue={true} />
    </SimpleForm>
  </Create>
);

// ---------- Edit ----------

const UserEdit = () => (
  <Edit mutationMode="pessimistic">
    <SimpleForm>
      <TextInput source="username" disabled />
      <TextInput source="email" type="email" />
      <TextInput source="firstName" label="First Name" />
      <TextInput source="lastName" label="Last Name" />
      <BooleanInput source="enabled" />
    </SimpleForm>
  </Edit>
);

export default {
  list: UserList,
  show: UserShow,
  create: UserCreate,
  edit: UserEdit,
};
