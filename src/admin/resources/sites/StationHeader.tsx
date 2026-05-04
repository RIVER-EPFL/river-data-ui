import React from 'react';
import {
    Card,
    CardContent,
    Box,
    Typography,
    Chip,
    Divider,
    Tooltip,
    IconButton,
    Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import { Link } from 'react-router-dom';

interface StationHeaderProps {
    site: {
        id: string;
        name: string;
        latitude: number | null;
        longitude: number | null;
        altitude_m: number | null;
    };
    project: { id: string; name: string } | undefined;
    statusSummary: {
        total: number;
        active: number;
        inactive: number;
        sensorsActive: number;
    };
}

export const StationHeader: React.FC<StationHeaderProps> = ({ site, project, statusSummary }) => (
    <Card sx={{ mb: 3 }}>
        <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Tooltip title="Back to sites list">
                    <IconButton component={Link} to="/admin/sites">
                        <ArrowBackIcon />
                    </IconButton>
                </Tooltip>
                <Typography variant="h5" fontWeight="bold">
                    {site.name}
                </Typography>
                <Button
                    component={Link}
                    to={`/admin/sites/${site.id}`}
                    startIcon={<EditIcon />}
                    variant="outlined"
                >
                    Edit Site
                </Button>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                {project && (
                    <Chip
                        label={`Project: ${project.name}`}
                        component={Link}
                        to={`/admin/projects/${project.id}/show`}
                        clickable
                        color="primary"
                        variant="outlined"
                    />
                )}
                {site.latitude != null && site.longitude != null && (
                    <Typography variant="body2" color="text.secondary">
                        {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                        {site.altitude_m != null && ` (${site.altitude_m}m)`}
                    </Typography>
                )}
                <Divider orientation="vertical" flexItem />
                <Chip label={`${statusSummary.total} parameters`} />
                <Chip label={`${statusSummary.active} active`} color="success" />
                <Chip label={`${statusSummary.sensorsActive} sensors deployed`} color="info" />
            </Box>
        </CardContent>
    </Card>
);
