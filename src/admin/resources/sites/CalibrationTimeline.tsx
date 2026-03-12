import React from 'react';
import { useGetList } from 'react-admin';
import { Box, Typography, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router-dom';

interface CalibrationRecord {
  id: string;
  sensor_id: string;
  slope: number;
  intercept: number;
  valid_from: string;
  performed_by: string | null;
  notes: string | null;
}

interface CalibrationTimelineProps {
  sensorId: string;
}

// Generate distinct colors for calibration segments
const SEGMENT_COLORS = [
  '#2196f3', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4',
  '#f44336', '#3f51b5', '#009688', '#ff5722', '#607d8b',
];

export const CalibrationTimeline: React.FC<CalibrationTimelineProps> = ({ sensorId }) => {
  const navigate = useNavigate();
  const { data: calibrations } = useGetList<CalibrationRecord>('sensor_calibrations', {
    filter: { sensor_id: sensorId },
    sort: { field: 'valid_from', order: 'ASC' },
    pagination: { page: 1, perPage: 50 },
  });

  if (!calibrations || calibrations.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No calibrations recorded
      </Typography>
    );
  }

  // Calculate timeline range
  const firstTime = new Date(calibrations[0].valid_from).getTime();
  const now = Date.now();
  const totalRange = now - firstTime;

  if (totalRange <= 0) return null;

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Calibration History
      </Typography>
      <Box
        sx={{
          display: 'flex',
          height: 20,
          borderRadius: 1,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {calibrations.map((cal, index) => {
          const start = new Date(cal.valid_from).getTime();
          const end = index < calibrations.length - 1
            ? new Date(calibrations[index + 1].valid_from).getTime()
            : now;
          const widthPct = ((end - start) / totalRange) * 100;

          const tooltipText = [
            `y = ${cal.slope}x + ${cal.intercept}`,
            `From: ${new Date(cal.valid_from).toLocaleDateString()}`,
            cal.performed_by ? `By: ${cal.performed_by}` : null,
          ].filter(Boolean).join('\n');

          return (
            <Tooltip key={cal.id} title={tooltipText} arrow>
              <Box
                onClick={() => navigate(`/sensor_calibrations/${cal.id}`)}
                sx={{
                  width: `${widthPct}%`,
                  minWidth: 4,
                  bgcolor: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
                  opacity: 0.7,
                  '&:hover': { opacity: 1 },
                  cursor: 'pointer',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography variant="caption" color="text.secondary">
          {new Date(calibrations[0].valid_from).toLocaleDateString()}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Now
        </Typography>
      </Box>
    </Box>
  );
};
