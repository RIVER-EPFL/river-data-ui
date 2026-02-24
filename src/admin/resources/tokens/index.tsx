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
  useRedirect,
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
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const jsonParse = (v: string) => {
  try { return JSON.parse(v); } catch { return v; }
};
const jsonFormat = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);

const TokenList = () => (
  <List>
    <Datagrid rowClick="show">
      <TextField source="name" />
      <ReferenceField source="project_scope" reference="projects" link="show" emptyText="-">
        <TextField source="name" />
      </ReferenceField>
      <BooleanField source="is_active" />
      <TextField source="created_by" />
      <DateField source="expires_at" showTime />
      <DateField source="last_used_at" showTime />
      <DateField source="created_at" showTime />
    </Datagrid>
  </List>
);

const TokenShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="name" />
      <TextField source="token_hash" label="Token Hash" />
      <ReferenceField source="project_scope" reference="projects" link="show" emptyText="-">
        <TextField source="name" />
      </ReferenceField>
      <FunctionField
        label="Permissions"
        render={(record: { permissions?: unknown }) =>
          record?.permissions ? JSON.stringify(record.permissions) : '-'
        }
      />
      <BooleanField source="is_active" />
      <DateField source="created_at" showTime />
      <DateField source="expires_at" showTime />
      <DateField source="last_used_at" showTime />
      <TextField source="created_by" />
    </SimpleShowLayout>
  </Show>
);

const TokenCreate = () => {
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const redirect = useRedirect();

  const handleCopy = async () => {
    if (!rawToken) return;
    await navigator.clipboard.writeText(rawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setRawToken(null);
    redirect('list', 'tokens');
  };

  return (
    <>
      <Create
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
            <SelectInput optionText="name" emptyText="All projects" />
          </ReferenceInput>
          <TextInput
            source="permissions"
            multiline
            parse={jsonParse}
            format={jsonFormat}
            helperText='JSON object, e.g. {"read": true, "write": false}'
          />
          <BooleanInput source="is_active" defaultValue={true} />
          <DateTimeInput source="expires_at" />
          <TextInput source="created_by" />
        </SimpleForm>
      </Create>
      <Dialog open={!!rawToken} maxWidth="sm" fullWidth>
        <DialogTitle>API Token Created</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Copy this token now. It will not be shown again.
          </Alert>
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
            <Typography variant="caption" color="success.main" sx={{ mt: 1, display: 'block' }}>
              Copied to clipboard
            </Typography>
          )}
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
