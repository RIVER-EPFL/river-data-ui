import { useState } from 'react';
import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  DateField,
  ReferenceField,
  FunctionField,
  Show,
  SimpleShowLayout,
  Create,
  SimpleForm,
  TextInput,
  BooleanInput,
  ReferenceInput,
  SelectInput,
  DateTimeInput,
  RadioButtonGroupInput,
  FormDataConsumer,
  useRedirect,
  useGetIdentity,
  type RaRecord,
} from 'react-admin';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  IconButton,
  Alert,
  Chip,
  Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

// ---------- List ----------

const PermissionsSummary = ({ record }: { record?: { permissions?: { read_metadata?: boolean; read_data?: boolean; write_metadata?: boolean; write_data?: boolean } } }) => {
  if (!record?.permissions) return <>All</>;
  const perms = record.permissions;
  const parts: string[] = [];
  if (perms.read_metadata) parts.push('Metadata');
  if (perms.read_data) parts.push('Data');
  if (perms.write_metadata) parts.push('Write Metadata');
  if (perms.write_data) parts.push('Write Data');
  return <>{parts.length ? parts.join(', ') : 'None'}</>;
};

const TokenList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <ReferenceField source="project_scope" reference="projects" link="show" emptyText="All projects">
        <TextField source="name" />
      </ReferenceField>
      <FunctionField
        label="Permissions"
        render={(record: { permissions?: { read_metadata?: boolean; read_data?: boolean; write_metadata?: boolean; write_data?: boolean } }) => (
          <PermissionsSummary record={record} />
        )}
      />
      <BooleanField source="is_active" />
      <TextField source="created_by" />
      <FunctionField
        source="expires_at"
        label="Expires"
        render={(record: { expires_at?: string }) =>
          record?.expires_at ? new Date(record.expires_at).toLocaleString() : 'Never'
        }
      />
      <DateField source="last_used_at" showTime />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

// ---------- Show ----------

const TokenShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <TextField source="token_hash" label="Token Hash" />
      <ReferenceField source="project_scope" reference="projects" link="show" emptyText="All projects">
        <TextField source="name" />
      </ReferenceField>
      <FunctionField
        label="Permissions"
        render={(record: { permissions?: { read_metadata?: boolean; read_data?: boolean; write_metadata?: boolean; write_data?: boolean } }) => {
          if (!record?.permissions) return '-';
          const p = record.permissions;
          return (
            <Stack direction="row" spacing={1}>
              {p.read_metadata && <Chip label="Read Metadata" size="small" color="primary" />}
              {p.read_data && <Chip label="Read Data" size="small" color="primary" />}
              {p.write_metadata && <Chip label="Write Metadata" size="small" color="secondary" />}
              {p.write_data && <Chip label="Write Data" size="small" color="secondary" />}
              {!p.read_metadata && !p.read_data && !p.write_metadata && !p.write_data && <Chip label="No permissions" size="small" color="default" />}
            </Stack>
          );
        }}
      />
      <BooleanField source="is_active" />
      <DateField source="created_at" showTime />
      <FunctionField
        source="expires_at"
        label="Expires"
        render={(record: { expires_at?: string }) =>
          record?.expires_at ? new Date(record.expires_at).toLocaleString() : 'Never'
        }
      />
      <DateField source="last_used_at" showTime />
      <TextField source="created_by" />
    </SimpleShowLayout>
  </Show>
);

// ---------- Create ----------

const EXPIRY_CHOICES = [
  { id: 'never', name: 'Never expires' },
  { id: 'custom', name: 'Custom date' },
];

const TokenCreate = () => {
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);
  const redirect = useRedirect();
  const { data: identity } = useGetIdentity();

  const handleCopy = async () => {
    if (!rawToken) return;
    await navigator.clipboard.writeText(rawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCurl = async () => {
    if (!rawToken) return;
    const cmd = `curl -H "Authorization: Bearer ${rawToken}" ${window.location.origin}/api/service/sites`;
    await navigator.clipboard.writeText(cmd);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  const handleClose = () => {
    setRawToken(null);
    redirect('list', 'tokens');
  };

  const transform = (data: Record<string, unknown>) => {
    // Build structured permissions object
    const permissions = {
      read_metadata: data['permissions.read_metadata'] ?? true,
      read_data: data['permissions.read_data'] ?? true,
      write_metadata: data['permissions.write_metadata'] ?? false,
      write_data: data['permissions.write_data'] ?? false,
    };

    // Handle expiry: "never" → null
    const expiresAt = data._expiry_mode === 'never' ? null : data.expires_at;

    // Auto-populate created_by from identity if empty
    const createdBy = data.created_by || identity?.fullName || undefined;

    // Remove internal fields and flatten
    const { _expiry_mode, 'permissions.read_metadata': _rm, 'permissions.read_data': _rd, 'permissions.write_metadata': _wm, 'permissions.write_data': _wd, ...rest } = data;
    return {
      ...rest,
      permissions,
      expires_at: expiresAt,
      created_by: createdBy,
    };
  };

  return (
    <>
      <Create
        transform={transform}
        mutationOptions={{
          onSuccess: (data: RaRecord) => {
            if (data.raw_token) {
              setRawToken(String(data.raw_token));
            } else {
              redirect('list', 'tokens');
            }
          },
        }}
      >
        <SimpleForm>
          <TextInput source="name" isRequired />
          <ReferenceInput source="project_scope" reference="projects">
            <SelectInput
              optionText="name"
              emptyText="All projects"
              helperText="Restrict this token to a specific project. Leave empty for access to all projects."
            />
          </ReferenceInput>

          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Permissions</Typography>
          <BooleanInput
            source="permissions.read_metadata"
            label="Read Metadata (projects, sites, parameters)"
            defaultValue={true}
          />
          <BooleanInput
            source="permissions.read_data"
            label="Read Data (readings, aggregates, alarms)"
            defaultValue={true}
          />
          <BooleanInput
            source="permissions.write_metadata"
            label="Write Metadata (create/update entities)"
            defaultValue={false}
          />
          <BooleanInput
            source="permissions.write_data"
            label="Write Data (push readings, trigger actions)"
            defaultValue={false}
          />

          <BooleanInput source="is_active" defaultValue={true} />

          <RadioButtonGroupInput
            source="_expiry_mode"
            label="Token Expiry"
            choices={EXPIRY_CHOICES}
            defaultValue="never"
          />
          <FormDataConsumer>
            {({ formData }) =>
              formData._expiry_mode === 'custom' ? (
                <DateTimeInput source="expires_at" label="Expires at" />
              ) : null
            }
          </FormDataConsumer>

          <TextInput
            source="created_by"
            defaultValue={identity?.fullName ?? ''}
            helperText="Auto-filled from your Keycloak username. Edit if needed."
          />
        </SimpleForm>
      </Create>

      <Dialog open={!!rawToken} maxWidth="sm" fullWidth>
        <DialogTitle>API Token Created</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Copy this token now. It will not be shown again.
          </Alert>

          {/* Raw token */}
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Token</Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              bgcolor: 'grey.100',
              p: 2,
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              wordBreak: 'break-all',
            }}
          >
            <Typography sx={{ flex: 1, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              {rawToken}
            </Typography>
            <IconButton onClick={handleCopy} size="small" sx={{ ml: 1 }}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
          {copied && (
            <Typography variant="caption" color="success.main" sx={{ mt: 0.5, display: 'block' }}>
              Copied to clipboard
            </Typography>
          )}

          {/* Usage instructions */}
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>How to use</Typography>
          <Box
            sx={{
              bgcolor: 'grey.100',
              p: 2,
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              wordBreak: 'break-all',
            }}
          >
            curl -H &quot;Authorization: Bearer {'<token>'}&quot; {window.location.origin}/api/service/sites
          </Box>
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopyCurl}
            sx={{ mt: 0.5 }}
          >
            {curlCopied ? 'Copied!' : 'Copy as curl command'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default {
  list: TokenList,
  show: TokenShow,
  create: TokenCreate,
};
