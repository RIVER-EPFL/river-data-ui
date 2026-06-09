import { GET } from './client';

// ─── Phase 4 contract: sensor identity overlay payloads ───

/** One contiguous deployment window for a (site, parameter) slot, as resolved by deployment history. */
export interface SensorIdentityBand {
	deployment_id: string;
	sensor_id: string;
	sensor_serial: string | null;
	sensor_name: string | null;
	site_id: string;
	site_name: string | null;
	parameter_id: string;
	/** ISO 8601 inclusive start. */
	from: string;
	/** ISO 8601 exclusive end; null = open (still active). */
	until: string | null;
}

/** A calibration window marker for a (sensor, parameter). */
export interface CalibrationMarker {
	calibration_id: string;
	sensor_id: string;
	slope: number;
	intercept: number;
	/** ISO 8601 inclusive start. */
	valid_from: string;
	/** ISO 8601 exclusive end; null = open. */
	valid_until: string | null;
}

/**
 * GET /api/sites/{siteId}/sensor_identity returns per-parameter deployment bands and calibration
 * markers for a time window. Fetched separately (lighter) rather than bloating the readings payload.
 */
export interface SensorIdentityResponse {
	site_id: string;
	/** Per global parameter_id → ordered bands covering the requested window. */
	bands: Record<string, SensorIdentityBand[]>;
	/** Per global parameter_id → calibration markers in the requested window. */
	calibrations: Record<string, CalibrationMarker[]>;
}

export const getSiteSensorIdentity = (
	siteId: string,
	params: { start: string; end: string; parameter_ids?: string },
) => GET<SensorIdentityResponse>(`/api/sites/${siteId}/sensor_identity`, params);

// ─── Sensor detail series ───

export interface SensorReadingsResponse {
	sensor_id: string;
	parameter_id: string;
	units: string | null;
	/** Resolution applied: 'raw' (per-point) or 'hourly'/'daily'/'weekly'/'monthly' (bucketed). */
	resolution: string;
	times: string[];
	/** Per-point value, or per-bucket average when aggregated. */
	raw: (number | null)[];
	/** Present when include_raw or always; calibrated_value materialized on readings. */
	calibrated: (number | null)[];
	/** Per-bucket min/max envelopes; empty in raw mode. */
	raw_min: (number | null)[];
	raw_max: (number | null)[];
	calibrated_min: (number | null)[];
	calibrated_max: (number | null)[];
	/** Per-point site assignment (deployment_id resolves a site); null when unpaired. */
	site_ids: (string | null)[];
	/** Full reading extent attributed to this sensor (independent of the query window). */
	data_start: string | null;
	data_end: string | null;
	/** Earliest reading at the sensor's open deployment slot (site+parameter, any sensor) - the
	 * backdate target; may precede data_start when history isn't yet attributed. Null if no open deployment. */
	slot_data_start: string | null;
}

export const getSensorReadings = (
	sensorId: string,
	params: { start?: string; end?: string; include_raw?: boolean; resolution?: string },
) => GET<SensorReadingsResponse>(`/api/sensors/${sensorId}/readings`, params);

/** Site-assignment bands for a single sensor (deployment windows). */
export interface SensorDeploymentBand {
	deployment_id: string;
	site_id: string;
	site_name: string | null;
	from: string;
	until: string | null;
}

export const getSensorDeploymentBands = (
	sensorId: string,
	params?: { start?: string; end?: string },
) => GET<{ sensor_id: string; bands: SensorDeploymentBand[] }>(
	`/api/sensors/${sensorId}/deployment_bands`,
	params,
);

// ─── Calibration window data resolution ───

export interface CalibrationWindowPoint {
	time: string;
	raw_value: number;
	calibrated_value: number | null;
	is_flagged: boolean;
}

export interface CalibrationWindowResponse {
	calibration_id: string;
	sensor_id: string;
	parameter_id: string;
	slope: number;
	intercept: number;
	valid_from: string;
	valid_until: string | null;
	point_count: number;
	/** Down-sampled sample of points the window resolves (capped server-side, e.g. 2000). */
	points: CalibrationWindowPoint[];
}

export const getCalibrationWindow = (calibrationId: string) =>
	GET<CalibrationWindowResponse>(`/api/sensor_calibrations/${calibrationId}/window`);
