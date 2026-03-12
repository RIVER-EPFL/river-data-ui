import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  DateField,
  ReferenceField,
  FunctionField,
  TopToolbar,
  CreateButton,
} from 'react-admin';

const PermissionsSummary = ({
  record,
}: {
  record?: { permissions?: { read_metadata?: boolean; read_data?: boolean; write_metadata?: boolean; write_data?: boolean } };
}) => {
  if (!record?.permissions) return <>All</>;
  const perms = record.permissions;
  const parts: string[] = [];
  if (perms.read_metadata) parts.push('Metadata');
  if (perms.read_data) parts.push('Data');
  if (perms.write_metadata) parts.push('Write Meta');
  if (perms.write_data) parts.push('Write Data');
  return <>{parts.length ? parts.join(', ') : 'None'}</>;
};

const ListActions = () => (
  <TopToolbar>
    <CreateButton resource="tokens" />
  </TopToolbar>
);

export const ApiTokensPanel = () => (
  <List resource="tokens" actions={<ListActions />} title=" ">
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
