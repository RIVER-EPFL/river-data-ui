import { useState, useEffect } from 'react';
import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  FunctionField,
  Show,
  SimpleShowLayout,
  Create,
  SimpleForm,
  TextInput,
  BooleanInput,
  Edit,
  useRecordContext,
  useNotify,
} from 'react-admin';
import {
  Chip,
  Stack,
  Typography,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Box,
  CircularProgress,
} from '@mui/material';
import { useRiverDataProvider } from '../../useRiverDataProvider';

// ---------- Helpers ----------

interface Role {
  id: string;
  name: string;
}

const useAvailableRoles = () => {
  const dataProvider = useRiverDataProvider();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dataProvider
      .listRoles()
      .then(({ data }) => setRoles(data))
      .catch(() => setRoles([]))
      .finally(() => setLoading(false));
  }, [dataProvider]);

  return { roles, loading };
};

// ---------- List ----------

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

const UserList = () => (
  <List sort={{ field: 'username', order: 'ASC' }}>
    <Datagrid rowClick="show">
      <TextField source="username" />
      <TextField source="email" />
      <TextField source="firstName" label="First Name" />
      <TextField source="lastName" label="Last Name" />
      <BooleanField source="enabled" />
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
    </SimpleShowLayout>
  </Show>
);

// ---------- Create ----------

const UserCreate = () => (
  <Create>
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

const RolesInput = () => {
  const record = useRecordContext();
  const { roles: availableRoles, loading } = useAvailableRoles();
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (record?.roles && !initialized) {
      setSelectedRoles(record.roles as string[]);
      setInitialized(true);
    }
  }, [record?.roles, initialized]);

  if (loading) {
    return (
      <Box sx={{ py: 1 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  const handleToggle = (roleName: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleName) ? prev.filter((r) => r !== roleName) : [...prev, roleName],
    );
  };

  const handleSave = async () => {
    if (!record?.id) return;
    setSaving(true);
    try {
      await dataProvider.assignUserRoles(record.id as string, selectedRoles);
      notify('Roles updated', { type: 'success' });
    } catch {
      notify('Failed to update roles', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const changed =
    initialized &&
    JSON.stringify([...selectedRoles].sort()) !==
      JSON.stringify([...(record?.roles as string[] || [])].sort());

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Realm Roles
      </Typography>
      <FormGroup row>
        {availableRoles.map((role) => (
          <FormControlLabel
            key={role.id}
            control={
              <Checkbox
                checked={selectedRoles.includes(role.name)}
                onChange={() => handleToggle(role.name)}
                size="small"
              />
            }
            label={role.name}
          />
        ))}
      </FormGroup>
      {changed && (
        <Box sx={{ mt: 1 }}>
          <Typography
            variant="caption"
            color="primary"
            sx={{ cursor: 'pointer', textDecoration: 'underline' }}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save role changes'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

const UserEdit = () => (
  <Edit mutationMode="pessimistic">
    <SimpleForm>
      <TextInput source="username" disabled />
      <TextInput source="email" type="email" />
      <TextInput source="firstName" label="First Name" />
      <TextInput source="lastName" label="Last Name" />
      <BooleanInput source="enabled" />
      <RolesInput />
    </SimpleForm>
  </Edit>
);

export default {
  list: UserList,
  show: UserShow,
  create: UserCreate,
  edit: UserEdit,
};
