import { Box } from '@mui/material';
import { Title } from 'react-admin';
import { SyncStatusPanel } from '../resources/system/SyncStatusPanel';

export const StreamsPage = () => (
    <Box>
        <Title title="Data Streams" />
        <SyncStatusPanel />
    </Box>
);
