import { GET, POST, PATCH } from './client';

// Single unified API tier. The `ADMIN` and `SERVICE` constants alias the same path —
// retained as documentation hints about which Keycloak role/token scope each endpoint
// requires (see `require_admin` vs scoped middleware on the backend).
const ADMIN = '/api';
const SERVICE = '/api';

// Search
export interface SearchResponse {
	query: string;
	results: {
		sites: Array<{ id: string; name: string }>;
		sensors: Array<{ id: string; serial_number: string | null; name: string | null }>;
		parameters: Array<{ id: string; name: string; display_name: string }>;
		projects: Array<{ id: string; name: string }>;
	};
	total: number;
}

export const search = (query: string) =>
	GET<SearchResponse>(`${ADMIN}/search`, { q: query });

// Alarms
export interface ActiveAlarm {
	site_id: string;
	site_name: string;
	parameter_id: string;
	parameter_name: string;
	current_value: number;
	threshold: {
		warning_min: number | null;
		warning_max: number | null;
		alarm_min: number | null;
		alarm_max: number | null;
	};
	severity: number;
	since: string;
}

export interface ActiveAlarmsResponse {
	alarms: ActiveAlarm[];
	total: number;
}

export interface AlarmSummaryResponse {
	total: number;
	by_severity: { warning: number; alarm: number };
	by_site: Array<{
		site_id: string;
		site_name: string;
		warning_count: number;
		alarm_count: number;
		latest_reading_time?: string | null;
	}>;
}

export const getActiveAlarms = () => GET<ActiveAlarmsResponse>(`${ADMIN}/alarms/active`);
export const getAlarmSummary = () => GET<AlarmSummaryResponse>(`${ADMIN}/alarms/summary`);

// Streams
export interface StreamStats {
	stream_id: string;
	reading_count: number;
	min_time: string | null;
	max_time: string | null;
	latest_value: number | null;
}

export const getStreamStats = (streamId: string) =>
	GET<StreamStats>(`${SERVICE}/streams/${streamId}/stats`);

export const pairStream = (streamId: string, siteParameterId: string) =>
	POST(`${SERVICE}/streams/${streamId}/pair`, { site_parameter_id: siteParameterId });

export const unpairStream = (streamId: string) =>
	POST(`${SERVICE}/streams/${streamId}/unpair`);

// Actions
export const recalibrateCalibration = (id: string) =>
	POST(`${ADMIN}/actions/sensor_calibrations/${id}/recalculate`);

export const rollbackDeployment = (deploymentId: string) =>
	POST<{ status: string; readings_reassigned: number; previous_deployment_id: string | null }>(
		`${ADMIN}/actions/rollback_deployment`,
		{ deployment_id: deploymentId },
	);

export const recomputeDerived = (id: string) =>
	POST(`${ADMIN}/actions/derived_parameters/${id}/recompute`);

export const refreshAggregates = (full = false) =>
	POST(`${SERVICE}/actions/refresh_aggregates`, { full });

export const invalidatePublicConfig = (slug: string) =>
	POST(`${ADMIN}/actions/invalidate_public_config/${slug}`);

// Merge parameters
export interface MergeParametersResponse {
	sites_merged: number;
	sites_reassigned: number;
	readings_moved: number;
	streams_updated: number;
	source_deleted: boolean;
}

export const mergeParameters = (sourceParameterId: string, targetParameterId: string) =>
	POST<MergeParametersResponse>(`${SERVICE}/actions/merge_parameters`, {
		source_parameter_id: sourceParameterId,
		target_parameter_id: targetParameterId,
	});

// Merge site parameters (same site)
export interface MergeSiteParametersResponse {
	merged_readings: number;
	merged_status_events: number;
	streams_updated: number;
	deployments_moved: number;
	source_deleted: boolean;
}

export const mergeSiteParameters = (sourceSiteParameterId: string, targetSiteParameterId: string) =>
	POST<MergeSiteParametersResponse>(`${SERVICE}/actions/merge_site_parameters`, {
		source_site_parameter_id: sourceSiteParameterId,
		target_site_parameter_id: targetSiteParameterId,
	});

// Reprocess a sensor's readings (re-derive calibration/deployment by time window)
export const reprocessSensor = (sensorId: string) =>
	POST<{ job_id: string; status: string }>(`${SERVICE}/actions/reprocess`, { sensor_id: sensorId });

// Derived preview
export interface PreviewDerivedRequest {
	formula: string;
	site_id: string;
	start: string;
	end: string;
}

export interface PreviewDerivedResponse {
	site: { id: string; name: string };
	times: string[];
	source_parameters: Array<{ name: string; units: string; values: (number | null)[] }>;
	derived: {
		name: string;
		formula: string;
		values: (number | null)[];
		errors: (string | null)[];
	};
}

export const previewDerived = (params: PreviewDerivedRequest) =>
	POST<PreviewDerivedResponse>(`${ADMIN}/actions/preview_derived`, params);

// Sync
export interface SyncService {
	id: string;
	service_type: string;
	instance_id: string;
	status: string;
	current_operation: string | null;
	last_heartbeat: string | null;
	last_sync_completed_at: string | null;
	last_error: string | null;
	health?: string;
	created_at: string;
	updated_at: string;
}

export interface SyncCommand {
	id: string;
	service_id: string;
	command: string;
	payload: object | null;
	status: 'pending' | 'acknowledged' | 'completed' | 'failed' | 'expired';
	result: object | null;
	created_at: string;
	expires_at: string;
	acknowledged_at: string | null;
	completed_at: string | null;
}

export interface SyncEvent {
	id: string;
	service_id: string;
	command_id: string | null;
	event_type: 'scheduled' | 'triggered' | 'full_sync';
	status: 'running' | 'completed' | 'partial' | 'failed';
	readings_synced: number;
	status_events_synced: number;
	errors: string[] | null;
	log: string[] | null;
	started_at: string;
	completed_at: string | null;
	duration_ms: number | null;
}

export interface SyncServiceCredential {
	id: string;
	client_id: string;
	service_type: string;
	service_id: string | null;
	revoked: boolean;
	created_at: string;
}

export const issueSyncCommand = (serviceId: string, command: string, payload?: object) =>
	POST<SyncCommand>(`${ADMIN}/sync/services/${serviceId}/commands`, { command, payload });

export const createServiceCredential = (serviceType: string) =>
	POST<{ client_id: string; client_secret: string }>(`${ADMIN}/sync/credentials`, {
		service_type: serviceType,
	});

export const revokeSyncService = (credentialId: string) =>
	POST(`${ADMIN}/sync/credentials/${credentialId}/revoke`);

// Pairing plans
export interface PairingPlanEntry {
	stream_id: string;
	source_key: string;
	source_name: string | null;
	action: string;
	project: { id: string | null; name: string; create: boolean };
	site: {
		id: string | null;
		name: string;
		create: boolean;
		latitude: number | null;
		longitude: number | null;
		altitude_m: number | null;
	};
	parameter: { id: string | null; name: string; create: boolean; units: string; group_key: string | null; original_names: string[] };
	confidence: string;
	warnings: string[];
	original_parameter_name: string | null;
}

export interface PairingPlanSummary {
	total_streams: number;
	will_pair: number;
	will_skip: number;
	projects_to_create: number;
	sites_to_create: number;
	parameters_to_create: number;
	unique_projects: number;
	unique_sites: number;
	unique_parameters: number;
}

export interface PairingPlan {
	id: string;
	source_system: string;
	status: string;
	created_by: string | null;
	summary: PairingPlanSummary;
	entries: PairingPlanEntry[];
	created_at: string;
	applied_at: string | null;
	apply_result: PairingPlanApplyResult | null;
}

export interface PairingPlanApplyResult {
	projects_created: number;
	sites_created: number;
	parameters_created: number;
	site_parameters_created: number;
	streams_paired: number;
	readings_backfilled: number;
}

export interface PlanEntryUpdate {
	stream_id: string;
	action?: string;
	project_name?: string;
	site_name?: string;
	parameter_name?: string;
	parameter_units?: string;
	parameter_id?: string;
}

export const createPairingPlan = (sourceSystem: string) =>
	POST<PairingPlan>(`${ADMIN}/sync/pairing-plans`, { source_system: sourceSystem });

export const getPairingPlan = (id: string) =>
	GET<PairingPlan>(`${ADMIN}/sync/pairing-plans/${id}`);

export interface SiteMetadata {
	site_name: string;
	latitude: number | null;
	longitude: number | null;
	altitude_m: number | null;
	glacier_name: string | null;
	glacier_rgi: string | null;
	location_type: string | null;
	catchment: string | null;
	full_name: string | null;
	elevation: number | null;
	device_serial: string | null;
	channel_id: string | null;
	sample_interval_sec: number | null;
}

export const getPlanSiteMetadata = (planId: string) =>
	GET<SiteMetadata[]>(`${ADMIN}/sync/pairing-plans/${planId}/site-metadata`);

export const updatePairingPlan = (id: string, updates: PlanEntryUpdate[]) =>
	PATCH<PairingPlan>(`${ADMIN}/sync/pairing-plans/${id}`, { updates });

export const applyPairingPlan = (id: string) =>
	POST<PairingPlanApplyResult>(`${ADMIN}/sync/pairing-plans/${id}/apply`);

export const revertPairingPlan = (id: string) =>
	POST(`${ADMIN}/sync/pairing-plans/${id}/revert`);

export const listPairingPlans = () => GET<PairingPlan[]>(`${ADMIN}/sync/pairing-plans`);

export const getUnpairedSummary = () =>
	GET<{ source_system: string; unpaired: number; paired: number }[]>(
		`${ADMIN}/sync/unpaired-summary`,
	);

// Roles
export interface KeycloakRole {
	id: string;
	name: string;
}

export const listRoles = () => GET<KeycloakRole[]>(`${ADMIN}/roles`);
export const assignUserRoles = (userId: string, roles: string[]) =>
	POST(`${ADMIN}/users/${userId}/roles`, { roles });
