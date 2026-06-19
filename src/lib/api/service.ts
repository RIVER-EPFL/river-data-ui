import { GET, POST, PATCH, PUT, DELETE } from './client';
import type { ApiToken, JobLogLine, ReprocessingJob } from './crud';

// Single unified API tier. The `ADMIN` and `SERVICE` constants alias the same path,
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
		parameters: Array<{ id: string; code: string; name: string }>;
		projects: Array<{ id: string; name: string }>;
	};
	total: number;
}

export const search = (query: string) =>
	GET<SearchResponse>(`${ADMIN}/search`, { q: query });

// Build/version metadata of the running API (authenticated; requires read_metadata).
export interface ApiVersion {
	name: string;
	version: string;
	commit: string;
	built_at: string;
}

export const getVersion = () => GET<ApiVersion>(`${SERVICE}/version`);

// Per-job timeline (reprocessing_job_logs). `afterSeq` tails new lines incrementally.
export const getJobLogs = (jobId: string, afterSeq?: number) =>
	GET<JobLogLine[]>(
		`${SERVICE}/reprocessing_jobs/${jobId}/logs${afterSeq != null ? `?after_seq=${afterSeq}` : ''}`,
	);

// Notifications — channel capabilities (env-gated; carries no secrets). The frontend uses this to
// enable a channel or render it greyed-out with a "configured via environment" note.
export interface NotificationsConfig {
	telegram: { available: boolean; botUsername?: string };
	email: { available: boolean; backend: 'smtp' | 'graph' | 'disabled' };
}

export const getNotificationsConfig = () =>
	GET<NotificationsConfig>(`${SERVICE}/config/notifications`);

// Self-service notification preferences (the caller's own, bound to their JWT sub server-side).
export interface MySubscriptionScope {
	project_id?: string;
	site_id?: string;
	parameter_id?: string;
	enabled: boolean;
}

export interface MyNotifications {
	email: string | null;
	email_verified: boolean;
	email_enabled: boolean;
	telegram_enabled: boolean;
	telegram: { status: 'unlinked' | 'pending' | 'linked'; code_expires_at?: string };
	subscriptions: MySubscriptionScope[];
}

export const getMyNotifications = () => GET<MyNotifications>(`${SERVICE}/notifications/me`);

export const updateMyNotifications = (body: {
	email_enabled?: boolean;
	telegram_enabled?: boolean;
}) => PATCH<MyNotifications>(`${SERVICE}/notifications/me`, body);

export const setMySubscriptions = (subscriptions: MySubscriptionScope[]) =>
	PUT<MyNotifications>(`${SERVICE}/notifications/me/subscriptions`, { subscriptions });

export const mintMyLinkCode = () =>
	POST<{ code: string; expires_at: string }>(`${SERVICE}/notifications/me/link_code`, {});

export const unlinkMyTelegram = () => DELETE<void>(`${SERVICE}/notifications/me/telegram`);

// Admin notification oversight — per-channel health probe (admin-only). `healthy` is null until a
// probe has run; `detail` carries the probe message (or failure reason).
export interface ChannelHealth {
	name: 'telegram' | 'email';
	available: boolean;
	healthy: boolean | null;
	detail: string | null;
	checkedAt: string | null;
}

export interface NotificationHealth {
	channels: ChannelHealth[];
}

export const getNotificationsHealth = () =>
	GET<NotificationHealth>(`${ADMIN}/notifications/health`);

export const refreshNotificationsHealth = () =>
	POST<NotificationHealth>(`${ADMIN}/notifications/health/refresh`, {});

// Send a one-off test message through a channel to a single recipient (admin-only).
export interface TestSendResult {
	channel: string;
	results: Array<{ recipient: string; status: 'sent' | 'failed'; error: string | null }>;
	allSent: boolean;
}

export const testSend = (body: { channel: 'telegram' | 'email'; recipient: string }) =>
	POST<TestSendResult>(`${ADMIN}/notifications/test-send`, body);

// Roster of users with notification preferences (admin-only, read-only).
export interface NotificationSubscriber {
	keycloak_sub: string;
	email_enabled: boolean;
	telegram_enabled: boolean;
	is_active: boolean;
	telegram_status: 'unlinked' | 'pending' | 'linked';
	subscription_overrides: number;
}

export const getNotificationSubscribers = () =>
	GET<NotificationSubscriber[]>(`${ADMIN}/notifications/subscribers`);

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
	/** When the breach started (from persisted alarm event). */
	started_at?: string | null;
	/** Persisted alarm-event id; present once the sweeper has recorded this breach. */
	event_id?: string;
	/** True when the open event has been acknowledged. */
	acknowledged: boolean;
	acknowledged_at?: string | null;
	acknowledged_by?: string | null;
	/** Highest severity seen while this event has been open (1=warning, 2=alarm). */
	max_severity?: number | null;
}

export interface AcknowledgedAlarmResponse {
	event_id: string;
	acknowledged_at: string;
	acknowledged_by: string;
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
		last_warning_at?: string | null;
		last_alarm_at?: string | null;
	}>;
}

export interface AlarmEvent {
	id: string;
	site_id: string;
	site_name: string;
	parameter_id: string;
	parameter_name: string;
	severity: number;
	max_severity: number;
	started_at: string;
	last_seen_at: string;
	value_at_start: number;
	last_value: number;
	resolved_at: string | null;
	resolved_value: number | null;
	acknowledged_at: string | null;
	acknowledged_by: string | null;
}

export interface AlarmEventsResponse {
	events: AlarmEvent[];
	total: number;
}

export const getActiveAlarms = () => GET<ActiveAlarmsResponse>(`${ADMIN}/alarms/active`);
export const getAlarmSummary = () => GET<AlarmSummaryResponse>(`${ADMIN}/alarms/summary`);

/** A threshold resolved per (site, parameter) by the backend's one 3-tier definition. */
export interface ResolvedThreshold {
	site_id: string;
	parameter_id: string;
	warning_min: number | null;
	warning_max: number | null;
	alarm_min: number | null;
	alarm_max: number | null;
	/** Which tier supplied it: a site override, a global row, or the parameter default. */
	source: 'site' | 'global' | 'default';
	/** Latest reading (last 30 days) for this slot, or null if none. Display only. */
	current_value: number | null;
}

/** The effective threshold per active sensor (site_parameter). The UI never re-resolves the tiers. */
export const getThresholds = (opts?: { site_id?: string; parameter_id?: string }) =>
	GET<ResolvedThreshold[]>(`${ADMIN}/alarms/thresholds`, opts);

export const getAlarmEvents = (opts?: {
	site_id?: string;
	severity?: number;
	status?: string;
	parameter_id?: string;
	start?: string;
	end?: string;
	limit?: number;
	offset?: number;
}) => GET<AlarmEventsResponse>(`${ADMIN}/alarms/events`, { ...opts });

/** Rebuild persisted alarm events from raw readings over a window (tracked job). */
export const rebuildAlarmEvents = (body: {
	site_id?: string;
	parameter_id?: string;
	start?: string;
	end?: string;
}) => POST<{ job_id: string; status: string }>(`${ADMIN}/actions/rebuild_alarm_events`, body);

/** Acknowledge an open alarm event (require_write_data). */
export const acknowledgeAlarm = (eventId: string) =>
	POST<AcknowledgedAlarmResponse>(`${ADMIN}/alarms/${eventId}/acknowledge`);

/** Remove acknowledgement from an open alarm event (require_write_data). */
export const unacknowledgeAlarm = (eventId: string) =>
	DELETE<void>(`${ADMIN}/alarms/${eventId}/acknowledge`);

// API token lifecycle (admin-only on the backend)
export const revokeToken = (id: string) => POST<ApiToken>(`${ADMIN}/tokens/${id}/revoke`);
export const rotateToken = (id: string) => POST<ApiToken>(`${ADMIN}/tokens/${id}/rotate`);

/** Distinct status codes present in the API-token audit log, for the audit filter dropdown. */
export const getAuditStatusCodes = () =>
	GET<{ status_codes: number[] }>(`${ADMIN}/api_token_audit_logs/distinct/status_codes`).then(
		(r) => r.status_codes,
	);

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

export interface ImportStreamResponse {
	sensor_id: string;
	attributed: number;
}

/** Import a stream's device into the sensor inventory (creates sensor + identity calibration,
 *  stamps existing readings) WITHOUT pairing it to a site. Separate from pairing/adopt. */
export const importStream = (streamId: string, parameterId: string) =>
	POST<ImportStreamResponse>(`${SERVICE}/streams/${streamId}/import`, { parameter_id: parameterId });

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

export const invalidatePublicConfig = (code: string) =>
	POST(`${ADMIN}/actions/invalidate_public_config/${code}`);

// Merge parameters
export interface MergeParametersResponse {
	sites_merged: number;
	sites_reassigned: number;
	readings_moved: number;
	streams_updated: number;
	source_deleted: boolean;
}

// Runs as a tracked job server-side; we poll it and surface the counts so callers keep their shape.
export async function mergeParameters(
	sourceParameterId: string,
	targetParameterId: string,
): Promise<MergeParametersResponse> {
	const { job_id } = await POST<{ job_id: string }>(`${SERVICE}/actions/merge_parameters`, {
		source_parameter_id: sourceParameterId,
		target_parameter_id: targetParameterId,
	});
	const job = await pollJob(job_id);
	if (job.status !== 'completed') throw new Error(job.error_message ?? 'Merge did not complete');
	return (job.detail?.counts ?? {}) as MergeParametersResponse;
}

// Merge site parameters (same site)
export interface MergeSiteParametersResponse {
	merged_readings: number;
	merged_status_events: number;
	streams_updated: number;
	deployments_moved: number;
	source_deleted: boolean;
}

export async function mergeSiteParameters(
	sourceSiteParameterId: string,
	targetSiteParameterId: string,
): Promise<MergeSiteParametersResponse> {
	const { job_id } = await POST<{ job_id: string }>(`${SERVICE}/actions/merge_site_parameters`, {
		source_site_parameter_id: sourceSiteParameterId,
		target_site_parameter_id: targetSiteParameterId,
	});
	const job = await pollJob(job_id);
	if (job.status !== 'completed') throw new Error(job.error_message ?? 'Merge did not complete');
	return (job.detail?.counts ?? {}) as MergeSiteParametersResponse;
}

// Reprocess a sensor's readings (re-derive calibration/deployment by time window)
export const reprocessSensor = (sensorId: string) =>
	POST<{ job_id: string; status: string }>(`${SERVICE}/actions/reprocess`, { sensor_id: sensorId });

// Replay a finished tracked job (server reconstructs it from the ids on its row). Returns a new job.
export const rerunJob = (jobId: string) =>
	POST<{ job_id: string; status: string }>(`${SERVICE}/reprocessing_jobs/${jobId}/rerun`, {});

// Job types the server will replay (mirrors the backend registry `is_rerunnable`).
const RERUNNABLE_TRIGGERS = new Set([
	'manual_reprocess',
	'calibration_create',
	'calibration_update',
	'calibration_delete',
	'calibration_recalculate',
	'deployment_create',
	'deployment_update',
	'deployment_delete',
	'deployment_edit',
	'manual_adopt',
	'sensor_swap',
	'refresh_aggregates',
	'refresh_aggregates_full',
	'derived_recompute',
]);

export const isRerunnable = (triggerType: string): boolean => RERUNNABLE_TRIGGERS.has(triggerType);

// Cooperatively cancel a running job. Takes effect at the job's next batch checkpoint.
export const cancelJob = (jobId: string) =>
	POST<{ status: string }>(`${SERVICE}/reprocessing_jobs/${jobId}/cancel`, {});

// Job types the server can cooperatively cancel (mirrors the backend registry `is_cancellable`).
const CANCELLABLE_TRIGGERS = new Set([
	'ingest_derived',
	'batch_derived',
	'derived_recompute',
	'csv_import',
	'janitor_run',
]);

export const isCancellable = (triggerType: string): boolean =>
	CANCELLABLE_TRIGGERS.has(triggerType);

// Bulk historical attribution: list open deployments with claimable pre-deployment history.
export interface BackfillCandidate {
	deployment_id: string;
	sensor_id: string;
	site_id: string;
	parameter_id: string;
	deployed_from: string;
	target_from: string;
	claimable_count: number;
}
export interface BackfillSiteSummary {
	site_id: string;
	deployments: number;
	claimable_count: number;
}
export interface BackfillCandidatesResponse {
	candidates: BackfillCandidate[];
	by_site: BackfillSiteSummary[];
	total_candidates: number;
	total_claimable: number;
}
export const getBackfillCandidates = () =>
	GET<BackfillCandidatesResponse>(`${SERVICE}/actions/backfill_candidates`);

export interface BackfillAttributionResponse {
	job_id: string;
	status: string;
	deployments_updated: number;
	estimated_readings: number;
}
// Backdate the matching open deployments + window-reprocess so historical orphans get attributed.
export const backfillAttribution = (body: { all?: boolean; site_id?: string; deployment_ids?: string[] }) =>
	POST<BackfillAttributionResponse>(`${SERVICE}/actions/backfill_attribution`, body);

// Calibration backfill: sensors with readings missing calibration_id.
export interface CalibrationBackfillCandidate {
	sensor_id: string;
	uncalibrated_count: number;
	target_from: string;
	earliest_calibration_from: string | null;
	is_identity: boolean;
}
export interface CalibrationBackfillCandidatesResponse {
	candidates: CalibrationBackfillCandidate[];
	total_candidates: number;
	total_uncalibrated: number;
}
export const getCalibrationCandidates = () =>
	GET<CalibrationBackfillCandidatesResponse>(`${SERVICE}/actions/calibration_candidates`);

export interface BackfillCalibrationsResponse {
	job_id: string;
	status: string;
	sensors_updated: number;
	estimated_readings: number;
}
export const backfillCalibrations = (body: { all?: boolean; sensor_id?: string; sensor_ids?: string[] }) =>
	POST<BackfillCalibrationsResponse>(`${SERVICE}/actions/backfill_calibrations`, body);

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

// Apply/revert now run as tracked background jobs; both return a job id to poll.
export const applyPairingPlan = (id: string) =>
	POST<{ job_id: string; status: string }>(`${ADMIN}/sync/pairing-plans/${id}/apply`);

export const revertPairingPlan = (id: string) =>
	POST<{ job_id: string; status: string }>(`${ADMIN}/sync/pairing-plans/${id}/revert`);

// Poll a tracked job until it reaches a terminal state, returning the final row.
export async function pollJob(
	jobId: string,
	opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ReprocessingJob> {
	const intervalMs = opts.intervalMs ?? 1000;
	const timeoutMs = opts.timeoutMs ?? 600_000;
	const start = Date.now();
	const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
	for (;;) {
		const job = await GET<ReprocessingJob>(`${SERVICE}/reprocessing_jobs/${jobId}`);
		if (terminal.has(job.status)) return job;
		if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for job');
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

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

// Realm directory search (LDAP-federated in production — covers all EPFL accounts).
// Each result includes the user's current realm roles.
export interface DirectoryUser {
	id: string;
	username: string;
	email: string | null;
	firstName: string | null;
	lastName: string | null;
	enabled: boolean;
	roles: string[];
}

export const searchDirectoryUsers = (q: string) =>
	GET<DirectoryUser[]>(`${ADMIN}/users/search`, { q });

// Grab samples
export interface GrabSampleReading {
	parameter_id: string;
	time: string;
	value: number;
	replicate_index?: number;
	sensor_id?: string;
}

export interface GrabSampleRequest {
	site_id: string;
	created_by?: string;
	readings: GrabSampleReading[];
}

export interface GrabSampleResponse {
	inserted: number;
	samples_created: number;
}

export const saveGrabSample = (req: GrabSampleRequest) =>
	POST<GrabSampleResponse>(`${SERVICE}/grab_samples`, req);
