import { ApiError, GET, POST, PATCH, PUT, DELETE } from './client';
import type { ApiToken, DataStream, JobLogLine, ReprocessingJob } from './crud';

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

// Notifications: Web Push capability (env-gated).
export interface NotificationsConfig {
	webPush: { available: boolean; vapidPublicKey?: string };
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
	webPushEnabled: boolean;
	pushSubscriptionCount: number;
	subscriptions: MySubscriptionScope[];
}

export const getMyNotifications = () => GET<MyNotifications>(`${SERVICE}/notifications/me`);

export const updateMyNotifications = (body: { web_push_enabled?: boolean }) =>
	PATCH<MyNotifications>(`${SERVICE}/notifications/me`, body);

export const setMySubscriptions = (subscriptions: MySubscriptionScope[]) =>
	PUT<MyNotifications>(`${SERVICE}/notifications/me/subscriptions`, { subscriptions });

export interface PushSubscriptionRow {
	id: string;
	endpoint: string;
	user_agent?: string;
	created_at: string;
	last_success_at?: string;
}

export const registerPushSubscription = (body: {
	endpoint: string;
	p256dh: string;
	auth: string;
	user_agent?: string;
}) => POST<PushSubscriptionRow>(`${SERVICE}/notifications/me/push`, body);

export const getMyPushSubscriptions = () =>
	GET<PushSubscriptionRow[]>(`${SERVICE}/notifications/me/push`);

export const deletePushSubscription = (endpoint: string) =>
	DELETE<void>(`${SERVICE}/notifications/me/push`, { endpoint });

export const testMyPush = () =>
	POST<void>(`${SERVICE}/notifications/me/push/test`, {});

export const scheduleMyPing = (seconds: number = 10) =>
	POST<{ seconds: number }>(`${SERVICE}/notifications/me/push/ping`, { seconds });

// Admin notification oversight.
export interface ChannelHealth {
	name: string;
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

export interface TestSendResult {
	channel: string;
	results: Array<{ recipient: string; status: 'sent' | 'failed'; error: string | null }>;
	allSent: boolean;
}

export const testSend = (body: { channel: string; recipient: string }) =>
	POST<TestSendResult>(`${ADMIN}/notifications/test-send`, body);

export interface NotificationSubscriber {
	keycloakSub: string;
	webPushEnabled: boolean;
	isActive: boolean;
	pushSubscriptionCount: number;
	subscriptionOverrides: number;
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
	// Rows stamped withdrawn by windowed reconciliation (included in reading_count).
	withdrawn_count: number;
	min_time: string | null;
	max_time: string | null;
	latest_value: number | null;
}

export const getStreamStats = (streamId: string) =>
	GET<StreamStats>(`${SERVICE}/streams/${streamId}/stats`);

// One windowed-ingest pass over a stream: what was submitted and what the diff did.
export interface StreamReceipt {
	id: string;
	at: string;
	window_from: string | null;
	window_to: string | null;
	submitted: number;
	new_rows: number;
	changed: number;
	unchanged: number;
	retained: number;
	rejected_total: number;
	dropped: number;
	withdrawn: number;
	braked: boolean;
}

export interface StreamReceiptsResponse {
	stream_id: string;
	total: number;
	receipts: StreamReceipt[];
}

export const listStreamReceipts = (streamId: string, page = 1, pageSize = 50) =>
	GET<StreamReceiptsResponse>(`${SERVICE}/streams/${streamId}/receipts`, {
		page,
		page_size: pageSize,
	});

export const pairStream = (streamId: string, siteParameterId: string) =>
	POST(`${SERVICE}/streams/${streamId}/pair`, { site_parameter_id: siteParameterId });

export const unpairStream = (streamId: string) =>
	POST(`${SERVICE}/streams/${streamId}/unpair`);

export interface PreviewReplicate {
	replicate_index: number;
	column: string | null;
	value: number | null;
	is_flagged: boolean;
	withdrawn: boolean;
}

export interface PreviewInstant {
	time: string;
	replicates: PreviewReplicate[];
	mean: number | null;
	sd: number | null;
	n: number;
}

export interface StreamPreview {
	stream_id: string;
	source_key: string;
	instants: PreviewInstant[];
}

/** The stream's most recent instants as the replicate rows pairing will serve them as. */
export const getStreamPreview = (streamId: string, limit = 3) =>
	GET<StreamPreview>(`${ADMIN}/streams/${streamId}/preview?limit=${limit}`);

export interface ImportStreamResponse {
	sensor_id: string;
	attributed: number;
}

/** Import a stream's device into the sensor inventory (creates the sensor and stamps its existing
 *  readings) WITHOUT pairing it to a site. Separate from pairing/adopt. No curve is created: the
 *  readings resolve whatever calibration windows the sensor already has, which may be none. */
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

// Bulk data-frequency reclassification: 'low' = lab/campaign (spot readings), 'high' = field
// stream (continuous). With retagExisting the server runs a tracked measurement_retag job that
// rewrites existing readings and refreshes aggregates.
export const retagSensorFrequency = (
	sensorIds: string[],
	dataFrequency: 'high' | 'low',
	retagExisting: boolean,
) =>
	POST<{ sensors_updated: number; data_frequency: string; job_id: string | null }>(
		`${SERVICE}/sensors/retag_frequency`,
		{ sensor_ids: sensorIds, data_frequency: dataFrequency, retag_existing: retagExisting },
	);

// Classify sensorless streams (portal imports) as continuous/spot/derived.
export const retagStreams = (
	scope: { streamIds?: string[]; sourceSystem?: string },
	measurementType: 'continuous' | 'spot' | 'derived',
	retagExisting: boolean,
) =>
	POST<{ streams_updated: number; measurement_type: string; job_id: string | null }>(
		`${SERVICE}/streams/retag`,
		{
			stream_ids: scope.streamIds ?? [],
			source_system: scope.sourceSystem ?? null,
			measurement_type: measurementType,
			retag_existing: retagExisting,
		},
	);

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

// Readings a calibration window covers that were never stamped with it. A reprocess resolves them
// against the curves that already exist; nothing is created.
export interface CalibrationBackfillCandidate {
	sensor_id: string;
	uncalibrated_count: number;
	target_from: string;
	earliest_calibration_from: string | null;
}
// Readings whose calibrated_value differs from raw_value while naming neither a calibration nor a
// standard curve. Reported only - the stored number is somebody's measurement.
export interface OrphanedCorrection {
	sensor_id: string | null;
	site_id: string | null;
	parameter_id: string | null;
	count: number;
	first_time: string;
	last_time: string;
}
export interface CalibrationBackfillCandidatesResponse {
	candidates: CalibrationBackfillCandidate[];
	total_candidates: number;
	total_uncalibrated: number;
	orphaned_corrections: OrphanedCorrection[];
	total_orphaned_corrections: number;
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

// Export summary: what a site export of this range can carry beyond the plain series.
export interface ExportSummary {
	annotation_count: number;
	annotated_points: number;
	flagged_readings: number;
	replicate_readings: number;
	// Readings breaching a warning or alarm bound over the range.
	alarm_readings: number;
	per_parameter: {
		parameter_id: string;
		code: string;
		annotation_count: number;
		annotated_points: number;
		flagged_readings: number;
		replicate_readings: number;
		alarm_readings: number;
	}[];
}

export const getSiteExportSummary = (siteId: string, start: string, end: string) =>
	GET<ExportSummary>(`${SERVICE}/sites/${siteId}/export/summary`, { start, end });

// Instruments overview: every instrument owning curves or feeding streams, with usage.
export interface CurveOverview {
	id: string;
	name: string | null;
	slope: number;
	intercept: number;
	r_squared: number | null;
	source_system: string | null;
	source_key: string | null;
	created_at: string | null;
	reading_count: number;
	first_used: string | null;
	last_used: string | null;
}

export interface InstrumentStreamRef {
	id: string;
	source_system: string;
	source_key: string;
	measurement_type: string | null;
	site_name: string | null;
	parameter_code: string | null;
}

export interface InstrumentOverview {
	id: string;
	name: string | null;
	serial_number: string | null;
	manufacturer: string | null;
	model: string | null;
	is_lab_instrument: boolean;
	source_system: string | null;
	source_key: string | null;
	curves: CurveOverview[];
	streams: InstrumentStreamRef[];
}

export const getInstrumentsOverview = () =>
	GET<{ instruments: InstrumentOverview[] }>(`${SERVICE}/instruments/overview`);

export interface CurveUsagePoint {
	time: string;
	replicate_index: number;
	raw_value: number;
	calibrated_value: number | null;
	is_flagged: boolean;
	site_name: string | null;
	parameter_code: string | null;
}

export interface CurveUsageResponse {
	curve_id: string;
	sensor_id: string;
	slope: number;
	intercept: number;
	reading_count: number;
	points: CurveUsagePoint[];
}

export const getCurveUsage = (curveId: string) =>
	GET<CurveUsageResponse>(`${SERVICE}/standard_curves/${curveId}/usage`);

// Sync
export interface SyncService {
	id: string;
	service_type: string;
	instance_id: string;
	status: string;
	current_operation: string | null;
	paused: boolean;
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
	parameter: {
		id: string | null;
		name: string;
		label: string | null;
		create: boolean;
		units: string;
		group_key: string | null;
		original_names: string[];
	};
	confidence: string;
	warnings: PlanWarning[];
	original_parameter_name: string | null;
	// Present when the stream is a replicate family: what is being paired is the group of
	// member columns, not the portal's average.
	replicates: PlanReplicateSummary | null;
	// The lab instrument this stream's standard curves belong to. A curve is fitted on one
	// instrument, so a reading naming a curve must name that instrument too; a stream that will
	// carry curve references and resolves to none has those readings dropped at ingest.
	instrument: PlanInstrumentRef | null;
	// The divisor this slot will publish its replicate standard deviation with, chosen here.
	// Left unset the slot stays undeclared and its audit disagreements are held for a decision.
	sd_estimator?: SdEstimator | null;
	// Evidence for that choice: open replicate-statistics holds on this stream, and how many of
	// them match the population signature.
	sd_holds?: number;
	sd_population_holds?: number;
}

// A catalog parameter an entry collides with, and what already depends on it. "Exists" alone does
// not say where or whether anything uses it, which is what decides a units conflict.
export interface ExistingParamRef {
	id: string;
	code: string;
	name: string;
	units: string;
	category: string;
	site_parameter_count: number;
	reading_count: number;
}

export interface PlanWarning {
	kind: 'units_mismatch' | 'empty_name' | 'sd_estimator_undeclared' | string;
	message: string;
	parameter: string | null;
	existing: ExistingParamRef | null;
	source_units: string | null;
}

export interface PlanCurveRef {
	id: string;
	name: string | null;
	slope: number;
	intercept: number;
}

export interface PlanInstrumentRef {
	// The source column naming a curve per reading, e.g. `doc_std_curve_id`. Null when the
	// instrument came from the stream and no column names a curve.
	curve_column: string | null;
	id: string | null;
	name: string;
	source_key: string;
	// How it was decided: already on the stream, matched against the source's curve labels,
	// repointed by hand, or proposed because nothing matched.
	resolved_by: 'stream' | 'curve_label' | 'manual' | 'placeholder' | string;
	create: boolean;
	confirmed: boolean;
	// True when each reading stores a standard_curve_id. False when the curve was applied
	// upstream and only the instrument is attributed, where stamping would correct twice.
	stamps_readings: boolean;
	curves: PlanCurveRef[];
}

// Replicate-family summary on a plan entry: how the portal's columns route into one stream.
export interface PlanReplicateSummary {
	n: number;
	member_columns: string[];
	curve_ref_column: string | null;
	portal_mean_column: string | null;
	portal_sd_column: string | null;
}

export interface PairingPlanSummary {
	total_streams: number;
	will_pair: number;
	will_skip: number;
	projects_to_create: number;
	sites_to_create: number;
	parameters_to_create: number;
	instruments_to_create: number;
	instruments_unconfirmed: number;
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
	instruments_created: number;
	readings_backfilled: number;
}

export interface PlanEntryUpdate {
	stream_id: string;
	action?: string;
	project_name?: string;
	site_name?: string;
	parameter_name?: string;
	parameter_units?: string;
	// Display label for a parameter the plan will create; ignored for matched existing parameters.
	parameter_label?: string;
	// Instrument decisions are per curve column, so any one entry settles every entry sharing it.
	instrument_id?: string;
	instrument_name?: string;
	instrument_confirmed?: boolean;
	// Detach the instrument from every entry this one groups with; an absent instrument_id means
	// unchanged, not none.
	instrument_clear?: boolean;
	// Which divisor this slot publishes its replicate standard deviation with. An empty string
	// clears the choice and leaves the slot undeclared.
	sd_estimator?: SdEstimator | '';
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

// One instrument decision in a plan: what it covers and the curves it owns. Only instruments the
// plan binds are listed; the rest of the inventory is reachable through the picker.
export interface PlanInstrumentGroup {
	scope: string | null;
	instrument_id: string | null;
	name: string;
	source_key: string;
	resolved_by: 'stream' | 'curve_label' | 'manual' | 'placeholder' | string;
	create: boolean;
	confirmed: boolean;
	stamps_readings: boolean;
	curve_column: string | null;
	stream_count: number;
	parameters: string[];
	site_count: number;
	anchor_stream_id: string | null;
	curves: PlanCurveRef[];
}

export interface PlanUnassignedParameter {
	scope: string;
	parameter: string;
	stream_count: number;
	site_count: number;
	anchor_stream_id: string;
	// The name an instrument for this parameter would get. Accepting it creates the instrument;
	// nothing is minted from a suggestion alone.
	suggested_name: string;
}

// A standard curve the source replicated, and the instrument it is currently fitted on.
export interface PlanCurveAssignment {
	id: string;
	name: string | null;
	slope: number;
	intercept: number;
	r_squared: number | null;
	source_key: string | null;
	sensor_id: string;
	instrument_name: string;
	reading_count: number;
}

export interface PlanInstruments {
	groups: PlanInstrumentGroup[];
	unassigned: PlanUnassignedParameter[];
	curves: PlanCurveAssignment[];
}

export const getPlanInstruments = (planId: string) =>
	GET<PlanInstruments>(`${ADMIN}/sync/pairing-plans/${planId}/instruments`);

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

// Replicate families: one stream per replicate group. The stream's metadata.replicates spec names
// the portal columns feeding the stream (a reading's replicate_index is its column's position in
// source_columns; a column with no value at an instant leaves that index absent, so a group can
// lack index 0) and the portal's precomputed avg/sd columns, which are audited at sync time
// rather than stored.
export interface ReplicateSpec {
	source_columns: string[];
	portal_mean_column?: string;
	portal_sd_column?: string;
	curve_ref_column?: string;
	calc?: string;
}

/** The replicate-family spec carried in a stream's metadata, or null for ordinary streams. */
export function replicateSpec(stream: DataStream): ReplicateSpec | null {
	const raw = stream.metadata?.['replicates'];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const spec = raw as Record<string, unknown>;
	if (!Array.isArray(spec.source_columns)) return null;
	return raw as unknown as ReplicateSpec;
}

// One stored value with the replicate index it is stored at, which is the source's column
// position and the only handle a flag can name.
export interface ReplicateAuditValue {
	index: number;
	value: number;
}

// A replicate group whose recomputed mean/sd disagrees with the portal's stored avg/sd. The group
// is stored and served (our recomputed statistics); the hold queues the disagreement for review.
export type HoldKind =
	| 'replicate_stats'
	| 'source_modified'
	| 'brake_fired'
	| 'missing_output'
	| 'stale_output'
	| 'curve_claim_stripped';

export interface ReplicateAuditHold {
	id: string;
	// null on event-audit findings, which are keyed on (site, parameter, instant) instead.
	stream_id: string | null;
	kind: HoldKind;
	source_system: string | null;
	source_key: string | null;
	source_name: string | null;
	site_name: string | null;
	parameter_name: string | null;
	parameter_code: string | null;
	// The tool an event finding names.
	tool: string | null;
	paired: boolean;
	group_time: string;
	expected: { mean: number | null; sd: number | null; n?: number | null };
	// Each value carries the replicate index it is stored at. Holds recorded before the index
	// travelled with the value hold bare numbers, and no position in that array stands for one.
	computed: {
		mean: number | null;
		sd: number | null;
		n: number;
		values?: ReplicateAuditValue[] | number[];
	};
	delta: { mean: number | null; sd: number | null; n?: number | null };
	// deferred holds sit on unpaired streams and become pending when the stream is paired;
	// remediated means replicates were flagged. use_portal/use_manual/consumed are legacy
	// statuses from the replaced-value model and occur only in history.
	status:
		| 'pending'
		| 'deferred'
		| 'acknowledged'
		| 'remediated'
		| 'use_portal'
		| 'use_manual'
		| 'consumed'
		| 'superseded';
	// Detected disagreement signature.
	classification: 'n_mismatch' | 'population_sd' | 'stale_subset' | 'quantization' | 'unexplained';
	// What a remediation did: which replicate indexes were flagged, or which estimator was
	// declared and what it replaced.
	resolution: {
		action?: string;
		replicate_indexes?: number[];
		reason?: string | null;
		estimator?: SdEstimator;
		scope?: 'slot' | 'instant';
		previous_estimator?: SdEstimator | null;
	} | null;
	created_at: string;
	acknowledged_by: string | null;
	acknowledged_at: string | null;
	// Disagreement sizes normalized by the mean magnitude; relative_delta is the
	// max of the two and remains the sort key.
	relative_delta: number;
	mean_relative_delta: number;
	sd_relative_delta: number;
}

export interface ReplicateAuditListResponse {
	holds: ReplicateAuditHold[];
	total: number;
	pending: number;
	deferred: number;
}


// Omitting `status` returns live holds. `status` also accepts the meta-value 'resolved'
// (everything past review) and 'deferred' (unpaired streams).
export const listReplicateAudits = (
	filter: {
		stream_id?: string;
		// Comma-separated stream UUIDs.
		stream_ids?: string;
		source_system?: string;
		status?: string;
		// Ceilings on the per-statistic disagreements; combined with AND.
		max_mean_relative_delta?: number;
		max_sd_relative_delta?: number;
		sort?: 'relative_delta_desc' | 'relative_delta_asc' | 'created_at_desc';
		// Only these two are filterable: 'population_sd' is the one signature with a SQL spelling
		// and 'not_population_sd' is its exact complement, so both filter and page without
		// dropping rows out of an already-counted page.
		classification?: 'population_sd' | 'not_population_sd';
		// Holds whose slot has (true) or has not (false) declared an sd estimator. `false` is the
		// set the resolution gate blocks from plain acknowledgement.
		estimator_declared?: boolean;
		page?: number;
		page_size?: number;
	} = {},
) => GET<ReplicateAuditListResponse>(`${ADMIN}/sync/replicate_audit_holds`, { ...filter });

// `skipped_undeclared_estimator` counts holds deliberately left pending: their disagreement is
// the population-divisor signature on a parameter that has not declared which formula it
// publishes, so accepting would record that decision without anyone having made it.
export interface AcknowledgeResult {
	acknowledged: number;
	skipped_undeclared_estimator?: number;
}

export const acknowledgeReplicateAudit = (id: string) =>
	POST<AcknowledgeResult>(`${ADMIN}/sync/replicate_audit_holds/${id}/acknowledge`, {});

export const acknowledgeReplicateAuditsBulk = (req: {
	stream_id?: string;
	source_system?: string;
	start?: string;
	end?: string;
	// Only acknowledge holds whose disagreements are at or below both ceilings (AND).
	max_mean_relative_delta?: number;
	max_sd_relative_delta?: number;
}) => POST<AcknowledgeResult>(`${ADMIN}/sync/replicate_audit_holds/acknowledge_bulk`, req);

// Which divisor a replicate group's standard deviation uses: 'sample' is n-1, 'population' is n.
export type SdEstimator = 'sample' | 'population';

export interface ResolveHoldResult {
	status: string;
	// 'estimator' mode, slot scope: the tracked sd_estimator_retag recomputing the slot's samples.
	job_id?: string | null;
	samples_affected?: number | null;
}

// Resolve a pending hold. 'ours' records that the recomputed statistics stand. 'flag' flags the
// named replicate indexes; the sample's mean/sd/n recompute immediately from the rest.
// 'estimator' declares which divisor the parameter (scope 'slot') or this one collection group
// (scope 'instant') publishes. Statistics are never entered directly: a resolution changes the
// input set or the specification, and the trigger recomputes.
export const resolveReplicateAudit = (
	id: string,
	body:
		| { mode: 'ours' }
		| { mode: 'flag'; replicate_indexes: number[]; reason?: string }
		| { mode: 'estimator'; estimator: SdEstimator; scope: 'slot' | 'instant' },
) => POST<ResolveHoldResult>(`${ADMIN}/sync/replicate_audit_holds/${id}/resolve`, body);

// One slot serving replicate statistics under no declared sd estimator. `population_signature_holds`
// is the evidence the operator rules on: holds whose disagreement is exactly the divisor.
export interface UndeclaredEstimatorSlot {
	site_id: string;
	parameter_id: string;
	site_name: string;
	parameter_name: string;
	parameter_code: string;
	site_parameter_id: string;
	undeclared_samples: number;
	// Whether a stream feeding the slot ships a precomputed sd column.
	source_reports_sd: boolean;
	streams: Array<{ stream_id: string; source_system: string | null; source_key: string | null }>;
	open_holds: number;
	population_signature_holds: number;
}

export interface UndeclaredEstimatorsResponse {
	total_slots: number;
	total_undeclared_samples: number;
	total_population_signature_holds: number;
	slots: UndeclaredEstimatorSlot[];
}

export const listUndeclaredSdEstimators = () =>
	GET<UndeclaredEstimatorsResponse>(`${ADMIN}/actions/undeclared_sd_estimators`);

export interface DeclareSdEstimatorResponse {
	site_parameter_id: string;
	estimator: SdEstimator | null;
	previous: SdEstimator | null;
	samples_affected: number;
	job_id?: string;
}

// The one path for changing a slot's declaration: writes the column and enqueues the tracked
// retag recomputing the slot's stored samples. The CRUD update excludes the field.
export const declareSdEstimator = (siteParameterId: string, estimator: SdEstimator | null) =>
	POST<DeclareSdEstimatorResponse>(
		`${ADMIN}/site_parameters/${siteParameterId}/declare_sd_estimator`,
		{ estimator },
	);

// Unflag a remediated hold's replicates and return it to review.
export const reopenReplicateAudit = (id: string) =>
	POST<{ status: string }>(`${ADMIN}/sync/replicate_audit_holds/${id}/reopen`, {});

export const getSyncCommand = (id: string) =>
	GET<SyncCommand>(`${ADMIN}/sync/commands/${id}`);

export const getPendingAuditCount = async (): Promise<number> =>
	(await listReplicateAudits({ page_size: 1 })).pending;

// Provenance: the assembled record of one measured instant.

export interface ProvenanceCalibrationRef {
	id: string;
	slope: number;
	intercept: number;
	valid_from: string;
	valid_until?: string;
}

export interface ProvenanceCurveRef {
	id: string;
	name?: string;
	slope: number;
	intercept: number;
}

export interface ProvenanceReading {
	replicate_index: number;
	raw_value: number;
	calibrated_value?: number;
	measurement_type?: string;
	is_flagged: boolean;
	flag_reason?: string;
	withdrawn_at?: string;
	withdrawn_reason?: string;
	ingested_at?: string;
	calibration?: ProvenanceCalibrationRef;
	standard_curve?: ProvenanceCurveRef;
}

export interface ProvenanceOrigin {
	stream_id: string;
	source_system: string;
	source_key: string;
	source_name?: string;
	classification: 'sync' | 'manual' | 'csv' | 'api';
	paired_at?: string;
	ingested_at?: string;
	receipt?: StreamReceipt;
}

export interface ProvenanceChain {
	sensor?: {
		id: string;
		serial_number?: string;
		name?: string;
		manufacturer?: string;
		model?: string;
	};
	deployment?: {
		id: string;
		site_id: string;
		site_name?: string;
		deployed_from: string;
		deployed_until?: string;
	};
}

export interface ProvenanceRecord {
	origin: ProvenanceOrigin;
	readings: ProvenanceReading[];
	chain: ProvenanceChain;
	event?: { id: string; collected_at: string; source: string; created_by?: string };
	computation?: {
		sample_id: string;
		created_by?: string;
		provenance?: Record<string, unknown>;
		run_source?: 'interactive' | 'csv_import' | 'chain' | string;
		// Which divisor this group's served standard deviation uses, and what chose it. A source
		// of 'default' means nothing declared one.
		sd_estimator: SdEstimator;
		sd_estimator_source: 'default' | 'slot' | 'sample' | 'stream' | 'tool';
	};
	holds: { id: string; kind: HoldKind; status: string; created_at: string }[];
}

export interface ProvenanceResponse {
	time: string;
	site_id: string | null;
	parameter_id: string | null;
	duplicate_slot: boolean;
	records: ProvenanceRecord[];
}

// Either { stream_id } or { site_id, parameter_id }, plus the exact reading timestamp.
export const getReadingProvenance = (key: {
	time: string;
	stream_id?: string;
	site_id?: string;
	parameter_id?: string;
	measurement_type?: string;
}) => GET<ProvenanceResponse>(`${SERVICE}/readings/provenance`, { ...key });

// Visits: the portal's wide data row per (site, date).

export interface VisitCell {
	parameter_id: string;
	value?: number;
	// Every replicate in the group is flagged / withdrawn.
	flagged: boolean;
	withdrawn: boolean;
	finding?: 'missing_output' | 'stale_output' | string;
}

export interface VisitRow {
	id: string;
	collected_at: string;
	source: 'manual' | 'portal_sync' | string;
	created_by: string | null;
	notes: string | null;
	parameters_filled: number;
	findings_open: number;
	cells: VisitCell[];
}

export interface VisitsResponse {
	site_id: string;
	total: number;
	page: number;
	page_size: number;
	// The grid's column set: parameters with spot readings at the site, ordered by code.
	expected_parameters: { parameter_id: string; code: string; name: string }[];
	visits: VisitRow[];
}

export const listSiteVisits = (
	siteId: string,
	opts: { start?: string; end?: string; page?: number; page_size?: number } = {},
) => GET<VisitsResponse>(`${SERVICE}/sites/${siteId}/visits`, { ...opts });

export interface EventCellReplicate {
	replicate_index: number;
	raw_value: number;
	calibrated_value?: number;
	flagged: boolean;
	withdrawn: boolean;
}

export interface EventCell {
	parameter_id: string;
	parameter_code: string;
	parameter_name: string;
	stream_id: string;
	served_value?: number;
	sample?: {
		sample_id: string;
		mean?: number;
		stdev?: number;
		n: number;
		has_provenance: boolean;
		tool?: string;
	};
	replicates: EventCellReplicate[];
	finding?: { id: string; kind: HoldKind; tool?: string; status: string };
}

export interface EventDetailResponse {
	id: string;
	site_id: string;
	collected_at: string;
	source: string;
	created_by?: string;
	notes?: string;
	cells: EventCell[];
}

export const getCollectionEventDetail = (id: string) =>
	GET<EventDetailResponse>(`${SERVICE}/collection_events/${id}/detail`);

export interface StagedEvent {
	id: string;
	site_id: string;
	collected_at: string;
	source: string;
	created_by?: string;
	notes?: string;
	/** False when the visit already stood at this instant. */
	created: boolean;
}

/** Stage a field visit, or adopt the one already standing at that (station, instant). */
export const stageCollectionEvent = (req: { site_id: string; collected_at: string; notes?: string }) =>
	POST<StagedEvent>(`${SERVICE}/collection_events/stage`, req);

export const recomputeCollectionEvent = (id: string) =>
	POST<{ job_id: string | null }>(`${SERVICE}/collection_events/${id}/recompute`, {});

export const runEventAudit = (req: { site_id?: string; collection_event_id?: string }) =>
	POST<{ job_id: string | null }>(`${SERVICE}/actions/event_audit`, req);

// Replicate reconciliation: migrate readings from legacy per-`_avg`-column streams onto their
// replicate-family streams (tracked job, migrate + verify, never deletes), then a separate
// re-verify + delete pass for the obsolete avg streams.
export interface ReconciliationFamily {
	family_stream_id: string;
	family_source_key: string;
	old_stream_id: string;
	old_source_key: string;
	site_parameter_id: string | null;
	migrated: boolean;
	old_readings: number;
	// Old-stream instants the family stream has no readings for. Zero = ready for cutover.
	missing_instants: number;
	ready: boolean;
}

export interface ReconciliationCandidatesResponse {
	families: ReconciliationFamily[];
	total_old_streams: number;
}

export const getReconciliationCandidates = (sourceSystem: string) =>
	GET<ReconciliationCandidatesResponse>(`${ADMIN}/sync/replicate_reconciliation/candidates`, {
		source_system: sourceSystem,
	});

export const startReplicateReconciliation = (sourceSystem: string, dryRun = false) =>
	POST<{ job_id: string }>(`${ADMIN}/sync/replicate_reconciliation`, {
		source_system: sourceSystem,
		...(dryRun ? { dry_run: true } : {}),
	});

export const startReconciliationDelete = (sourceSystem: string) =>
	POST<{ job_id: string }>(`${ADMIN}/sync/replicate_reconciliation/delete`, {
		source_system: sourceSystem,
	});

// Roles
export interface KeycloakRole {
	id: string;
	name: string;
}

export const listRoles = () => GET<KeycloakRole[]>(`${ADMIN}/roles`);
export const assignUserRoles = (userId: string, roles: string[]) =>
	POST(`${ADMIN}/users/${userId}/roles`, { roles });

// Project visibility grants: which projects a non-admin user may see and act in. Keyed by the
// user's Keycloak id (== `sub`). PUT replaces the whole set.
export interface GrantedProject {
	project_id: string;
	name: string;
}
export const getUserGrants = (userId: string) =>
	GET<GrantedProject[]>(`${ADMIN}/users/${userId}/grants`);

// The caller's visible sites as a project → subproject → site tree, grant-scoped server-side.
// Drives the sidebar site navigator. Keycloak-only, like `/api/me`.
export interface NavigatorSite {
	id: string;
	name: string;
}
export interface NavigatorSubproject {
	id: string | null;
	name: string;
	sites: NavigatorSite[];
}
export interface NavigatorProject {
	project_id: string;
	name: string;
	subprojects: NavigatorSubproject[];
}
export const getMySites = () => GET<NavigatorProject[]>(`${ADMIN}/me/sites`);
export const setUserGrants = (userId: string, projectIds: string[]) =>
	PUT(`${ADMIN}/users/${userId}/grants`, { project_ids: projectIds });

// Realm directory search (LDAP-federated in production, covers all EPFL accounts).
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

// Analytical tools. `GET /tools` serves the manifest of every active DB-stored R script;
// `POST /tools/{name}/calculate` runs one. Kinds: number | integer | string | boolean |
// enum:<v1|v2|...> | array | object | replicate_grid.
/**
 * The object form of a param's `when`: a condition on another param's value, carrying either
 * `equals` or `any_of`. This is the form the server enforces requiredness through.
 */
export interface ToolParamCondition {
	param: string;
	equals?: unknown;
	any_of?: unknown[];
}

/** A plain string is an advisory note and gates nothing; the object form is a condition. */
export type ToolParamWhen = string | ToolParamCondition;

export function isToolParamCondition(when: ToolParamWhen | null): when is ToolParamCondition {
	return typeof when === 'object' && when !== null;
}

/** One column of a structured param, as the manifest declares it. */
export interface ToolStructField {
	name: string;
	label: string;
	units: string | null;
	required: boolean;
	/** Numbers the field holds; above 1 it is a list, entered as that many inputs. */
	values: number;
	/** False for a column typed on the bench to feed a computed one, and never sent. */
	send: boolean;
	/** `[minuend, subtrahend]`, both naming fields of the same structure. */
	computed: { subtract: [string, string] } | null;
}

/**
 * What a structured param's value holds. `object` is one object of fields, `rows` an array of
 * them, `lists` an object of number lists keyed by field name.
 */
export interface ToolStructure {
	layout: 'object' | 'rows' | 'lists';
	fields: ToolStructField[];
	rows: number;
	max_rows: number | null;
	row_labels: 'letters' | 'numbers';
	values: number;
	value_labels: string[];
	/** True where the tool reads more column spellings than the form offers. */
	additional_fields: boolean;
}

export interface ToolParam {
	name: string;
	label: string;
	kind: string;
	units: string | null;
	required: boolean;
	default: unknown;
	/** Null when the param is unconditional; see `ToolParamWhen` for the two forms. */
	when: ToolParamWhen | null;
	/** Absent on a scalar param, and on a structured one whose columns nothing declares. */
	structure?: ToolStructure | null;
	/** Help text shown beside the field. */
	description?: string | null;
	/** Key of the manifest section the field renders under. */
	section?: string | null;
	/** `replicates` only: the catalog parameter the entered replicates are readings of. */
	parameter_code?: string | null;
	/** `replicates` only: rows the form opens with; never a limit. */
	suggested?: number | null;
	/** `replicates` only: the curve slot whose chosen curve corrects the stored replicates. */
	curve?: string | null;
	/** The catalog parameter `parameter_code` resolves to, served by `GET /tools`. */
	parameter?: ResolvedParameter | null;
}

/** Which half of an output's declaration the server found the catalog row by. */
export type ToolParameterResolvedBy = 'id' | 'code';

/**
 * The catalog parameter an output saves to, resolved server-side against the database serving the
 * request. A client reads this instead of matching codes against whatever slice of the catalog it
 * happens to hold.
 */
export interface ResolvedParameter {
	id: string;
	code: string;
	name: string;
	default_units: string | null;
	/** True for a catalog entry created mechanically rather than by a person. */
	needs_review: boolean;
	resolved_by: ToolParameterResolvedBy;
	/** True when `parameter_id` names no catalog row and the code resolved instead. */
	dangling_parameter_id: boolean;
}

export interface ToolOutput {
	key: string;
	label: string;
	units: string | null;
	/** Result keys arrive suffixed per replicate ({base}_{rep}). */
	per_replicate: boolean;
	/** Set on avg/sd rows computed from another output; display-only, never saved. */
	aggregate_of: string | null;
	/**
	 * 'mean' or 'sd': the engine computes this output over the curve-applied values of the
	 * replicates param `aggregate_of` names, honoring the declared divisor; the script never
	 * computes it.
	 */
	aggregate?: 'mean' | 'sd' | null;
	/** The catalog parameter this output saves to. Authoritative over the code when both are set. */
	parameter_id: string | null;
	/**
	 * The portable half of the same link: an id means nothing in another database, so the seeded
	 * manifests carry only this and the server stamps it whenever an output names an id alone.
	 */
	suggested_parameter_code: string | null;
	/**
	 * Which divisor the samples saved from this output use for their standard deviation.
	 * 'sample' or 'population' fix it and the operator never sees it; 'selectable' offers the
	 * choice on the tool page; null takes the parameter's own declaration, which is the usual
	 * case.
	 */
	sd_estimator?: SdEstimator | 'selectable' | null;
	/** Served by `GET /tools`, absent from a manifest an author is editing. */
	parameter?: ResolvedParameter | null;
}

export interface ToolCurveSlot {
	name: string;
	label: string;
	required: boolean;
	description?: string | null;
}

/**
 * A version's manifest: the tool's whole interface. Every list is optional on the wire (the
 * server defaults each to empty), so a manifest under construction is a valid one.
 */
export interface ToolManifest {
	label: string;
	description?: string | null;
	params?: ToolParam[];
	outputs?: ToolOutput[];
	/** Bare constant names; the server resolves their values from the constants table. */
	constants?: string[];
	curves?: ToolCurveSlot[];
	sections?: ToolSection[];
	station_inputs?: ToolStationInput[];
	event_inputs?: ToolEventInput[];
	qc?: Record<string, unknown> | null;
	match_keywords?: string[];
}

/** A titled group of fields on the entry form. */
export interface ToolSection {
	key: string;
	label: string;
	description?: string | null;
}

/**
 * One stored test case. `curves` are merged into the request body alongside `inputs`, `expected`
 * is compared key by key within the tolerance, and `absent` names keys the result must not carry.
 * `constants` makes a case reproducible whatever the constants table holds; without it the case
 * reads the catalog.
 */
export interface ToolTestCase {
	name?: string;
	inputs?: Record<string, unknown>;
	curves?: Record<string, unknown>;
	expected?: Record<string, unknown>;
	absent?: string[];
	constants?: Record<string, number>;
}

export interface ToolTestCases {
	/** Relative, applied as tol * max(|expected|, 1). Defaults to 1e-9. */
	tolerance?: number;
	cases?: ToolTestCase[];
}

export interface ToolDescriptor {
	name: string;
	label: string;
	description: string | null;
	endpoint: string;
	params: ToolParam[];
	outputs: ToolOutput[];
	constants: string[];
	curves: ToolCurveSlot[];
	/** Station properties resolved from the site at calculate time (fill-if-missing). */
	station_inputs?: ToolStationInput[];
	/** Same-event parameter reads resolved at (site_id, collected_at) (fill-if-missing). */
	event_inputs?: ToolEventInput[];
	/** QC declarations (replicate pooling, check exclusions), as authored. */
	qc?: Record<string, unknown>;
	sections?: ToolSection[];
	match_keywords: string[];
	script_version_id: string;
	version_no: number;
}

export interface ToolStationInput {
	property: string;
	param?: string | null;
	required: boolean;
}

export interface ToolEventInput {
	param: string;
	parameter_code: string;
}

export interface ToolVersionRef {
	/** Null for a draft run: no stored version produced those numbers. */
	script_version_id: string | null;
	version_no: number | null;
	content_hash: string;
	/** Null when the runner did not answer with its runtime identity. */
	runner_image: string | null;
	r_version: string | null;
}

/** A curve as the runner received it. `standard_curve_id` is set when it came from the catalog. */
export interface ToolResolvedCurve {
	slope: number;
	intercept: number;
	standard_curve_id: string | null;
	label: string | null;
}

/** One entry of the `curves` snapshot: the manifest slot name and the curve resolved into it. */
export interface ToolCurveSnapshot {
	name: string;
	curve: ToolResolvedCurve;
}

export interface ToolCalculateResponse {
	tool: string;
	results: Record<string, unknown>;
	inputs_used: string[];
	inputs_ignored: string[];
	/** The constant values the server resolved, by name. Empty when the manifest declares none. */
	constants: Record<string, number>;
	/** Empty when no curve slot was filled. */
	curves: ToolCurveSnapshot[];
	tool_version: ToolVersionRef;
	/** Station properties resolved from the site, as {property, param, value}. */
	station_inputs?: { property: string; param: string; value: number }[];
	/** Same-event values resolved at (site_id, collected_at). */
	event_inputs?: { param: string; parameter_code: string; parameter_id: string; value: number }[];
	/** The stored tool_runs row for this calculation; pass as `tool_run_id` when saving. */
	run_id: string;
}

export const listTools = () => GET<ToolDescriptor[]>(`${SERVICE}/tools`);

export const calculateTool = (name: string, body: Record<string, unknown>) =>
	POST<ToolCalculateResponse>(`${SERVICE}/tools/${encodeURIComponent(name)}/calculate`, body);

// Tool script authoring (admin-only). Versions are immutable; activation flips the pointer and
// activating an older version is the rollback.
export interface ToolScriptSummary {
	id: string;
	name: string;
	label: string;
	description: string | null;
	active_version_id: string | null;
	active_version_no: number | null;
	version_count: number;
	updated_at: string;
}

export interface ToolVersionSummary {
	id: string;
	version_no: number;
	content_hash: string;
	entry_function: string;
	/** What changed in this version and why, as its author wrote it. */
	note: string | null;
	created_by: string | null;
	created_at: string;
	validated_at: string | null;
	active: boolean;
}

export interface ToolScriptDetail extends ToolScriptSummary {
	versions: ToolVersionSummary[];
}

export interface ToolVersionDetail {
	id: string;
	version_no: number;
	script: string;
	entry_function: string;
	manifest: Record<string, unknown>;
	test_cases: Record<string, unknown>;
	content_hash: string;
	note: string | null;
	created_by: string | null;
	created_at: string;
	validated_at: string | null;
}

export interface ToolLintFinding {
	line: number;
	message: string;
}

export interface ToolCaseResult {
	name: string;
	passed: boolean;
	failures: string[];
	error: string | null;
}

export interface ToolValidateResponse {
	passed: boolean;
	cases: ToolCaseResult[];
	validated_at: string | null;
}

export interface ToolActivationRecord {
	from_version_no: number | null;
	to_version_no: number;
	activated_by: string | null;
	activated_at: string;
}

export const listToolScripts = () => GET<ToolScriptSummary[]>(`${ADMIN}/tool_scripts`);

export const getToolScript = (id: string) => GET<ToolScriptDetail>(`${ADMIN}/tool_scripts/${id}`);

export const createToolScript = (body: {
	name: string;
	label: string;
	description?: string;
	created_by?: string;
}) => POST<ToolScriptSummary>(`${ADMIN}/tool_scripts`, body);

export const updateToolScript = (id: string, body: { label?: string; description?: string }) =>
	PATCH<ToolScriptSummary>(`${ADMIN}/tool_scripts/${id}`, body);

export const createToolVersion = (
	id: string,
	body: {
		script: string;
		entry_function?: string;
		manifest: ToolManifest;
		test_cases?: ToolTestCases;
		note?: string;
		/** Ignored by the server, which records the authenticated caller. */
		created_by?: string;
	},
) =>
	POST<{ version: ToolVersionSummary; lint: ToolLintFinding[] }>(
		`${ADMIN}/tool_scripts/${id}/versions`,
		body,
	);

export const getToolVersion = (id: string, versionId: string) =>
	GET<ToolVersionDetail>(`${ADMIN}/tool_scripts/${id}/versions/${versionId}`);

export const validateToolVersion = (id: string, versionId: string) =>
	POST<ToolValidateResponse>(`${ADMIN}/tool_scripts/${id}/versions/${versionId}/validate`, {});

export const activateToolVersion = (id: string, versionId: string, activatedBy?: string) =>
	POST<ToolScriptSummary>(`${ADMIN}/tool_scripts/${id}/versions/${versionId}/activate`, {
		...(activatedBy ? { activated_by: activatedBy } : {}),
	});

export const listToolActivations = (id: string) =>
	GET<ToolActivationRecord[]>(`${ADMIN}/tool_scripts/${id}/activations`);

// Script inspection. The runner parses the script and walks the tree; nothing is evaluated, so a
// half-written script is safe to inspect and a syntax error is a 200 with `parse_ok: false`.

/** `line`/`column` are absent when R's message carries no position. */
export interface ToolParseError {
	message: string;
	line: number | null;
	column: number | null;
}

/** A detection the parse tree cannot complete. `expressions` is empty when `any` is false. */
export interface ToolDynamicFlag {
	any: boolean;
	expressions: string[];
}

/**
 * Every list is a floor rather than a complete set: keys assembled at run time (a replicate
 * letter pasted onto a base name) do not exist in the source. While `dynamic_outputs.any` is
 * true, `outputs` is short by an unknown amount and a manifest declaring more is not thereby
 * wrong; `dynamic_reads.any` says the same about `inputs`, `constants` and `curves`.
 */
export interface ToolScriptInspection {
	parse_ok: boolean;
	/** Null when the script parses. */
	parse_error: ToolParseError | null;
	entry: string;
	entry_found: boolean;
	/** The entry function's formals in declaration order; the runner calls them positionally. */
	entry_args: string[];
	inputs: string[];
	constants: string[];
	curves: string[];
	outputs: string[];
	dynamic_outputs: ToolDynamicFlag;
	dynamic_reads: ToolDynamicFlag;
	functions_defined: string[];
	functions_called: string[];
	/** The script's own top-level functions the entry function calls. */
	script_functions_used: string[];
	libraries: string[];
	namespaces: string[];
}

/**
 * What the script reads set against what the manifest declares. A comparison only: it proposes no
 * manifest. Each list may be empty. When `reads_complete` is false every `unread_*` entry is
 * possible rather than certain, and when `outputs_complete` is false the same holds for outputs.
 */
export interface ToolManifestReconciliation {
	undeclared_inputs: string[];
	undeclared_constants: string[];
	undeclared_curves: string[];
	unread_params: string[];
	unread_constants: string[];
	unread_curves: string[];
	reads_complete: boolean;
	outputs_complete: boolean;
}

export interface ToolInspectResponse extends ToolScriptInspection {
	/** Null when the request carried no manifest. */
	reconciliation: ToolManifestReconciliation | null;
}

export const inspectToolScript = (body: {
	script: string;
	entry_function?: string;
	manifest?: ToolManifest;
}) => POST<ToolInspectResponse>(`${ADMIN}/tool_scripts/inspect`, body);

// Draft run: unsaved editor content through the same manifest validation, constant resolution and
// curve resolution as a real calculate. Writes nothing.

export interface ToolDraftRunRequest {
	script: string;
	entry_function?: string;
	manifest: ToolManifest;
	/** The calculate body: the manifest's params, plus its curve slots as fields of the same body. */
	inputs?: Record<string, unknown>;
	/** An override must name every constant the manifest declares; omit it to read the catalog. */
	constants?: Record<string, number>;
}

/** Where a draft run ended, and therefore where the editor renders it. */
export type ToolDraftFailureKind = 'body_refused' | 'script_error' | 'runner_unavailable';

export interface ToolDraftFailure {
	kind: ToolDraftFailureKind;
	message: string;
	/** The R call that raised; null for the two non-script kinds. */
	call: string | null;
	traceback: string[];
}

/**
 * A draft run answers 200 whether or not the script ran: a refused body, a raised script and an
 * absent runner are findings about the draft, so they arrive next to the lint findings rather than
 * discarding them.
 */
export interface ToolDraftRunResponse {
	ran: boolean;
	/** Present only when `ran`. */
	results?: Record<string, unknown>;
	inputs_used?: string[];
	inputs_ignored?: string[];
	constants?: Record<string, number>;
	curves?: ToolCurveSnapshot[];
	/** Present only when the run ended without results. */
	failure?: ToolDraftFailure | null;
	/** The version fields are null here: nothing about a draft is stored. */
	tool_version: ToolVersionRef;
	/** Findings do not stop a draft from running; the version create still refuses to store them. */
	lint: ToolLintFinding[];
}

export const draftRunToolScript = (body: ToolDraftRunRequest) =>
	POST<ToolDraftRunResponse>(`${ADMIN}/tool_scripts/draft_run`, body);

/** Lint findings from a refused version create (409 { error, detail }); null otherwise. */
export function toolLintFindings(e: unknown): ToolLintFinding[] | null {
	if (!(e instanceof ApiError) || e.status !== 409) return null;
	try {
		const body = JSON.parse(e.message) as { detail?: ToolLintFinding[] };
		return Array.isArray(body.detail) ? body.detail : null;
	} catch {
		return null;
	}
}

// Grab samples
export interface GrabSampleReading {
	parameter_id: string;
	time: string;
	value: number;
	replicate_index?: number;
	sensor_id?: string;
	/**
	 * The named output of the referenced tool run this reading stores. Required on every reading
	 * when the request carries `tool_run_id`, refused otherwise.
	 */
	output?: string;
	/**
	 * The named `replicates` input of the referenced tool run this reading stores, raw, at
	 * `replicate_index`. A curve the run applied is recorded here as `standard_curve_id` and
	 * applied by the database, never a second time.
	 */
	input?: string;
	/**
	 * A `standard_curves` row on the same instrument as `sensor_id`, applied on top of the base
	 * calibration the API resolves from that instrument's windows at `time`. Sending a curve from
	 * another instrument, or one without `sensor_id`, is refused. Omit it when the value has
	 * already been curve-corrected upstream, otherwise the correction is applied twice.
	 */
	standard_curve_id?: string;
}

export interface GrabSampleRequest {
	site_id: string;
	created_by?: string;
	// Stamped onto the samples rows the request creates or reuses.
	label?: string;
	notes?: string;
	// Without 'replace', writing to an existing replicate group is refused with 409 and the
	// existing groups in the error detail; 'replace' overwrites them.
	mode?: 'replace';
	// Computes everything (preview and existing_groups included) and writes nothing.
	dry_run?: boolean;
	// The tool run (calculate response `run_id`) these readings came from. The server builds the
	// provenance blob from its stored run row; every reading must then name the run output it
	// stores and carry that output's value.
	tool_run_id?: string;
	// A seasonal check (from seasonalCheck) covering exactly these (parameter, value) pairs. The
	// server refuses a save whose values the named check did not screen.
	check_id?: string;
	// The divisor the samples this save creates compute their standard deviation with, sent only
	// when the operator chose one for a `selectable` output. A manifest that fixes an estimator is
	// read server-side from the run, never repeated here.
	sd_estimator?: SdEstimator;
	readings: GrabSampleReading[];
}

export interface GrabPreviewCurve {
	id: string;
	name: string | null;
	slope: number;
	intercept: number;
	equation: string;
}

export interface GrabPreviewRow {
	parameter_id: string;
	time: string;
	replicate_index: number;
	raw_value: number;
	base_calibration?: GrabPreviewCurve | null;
	standard_curve?: GrabPreviewCurve | null;
	composed_equation?: string | null;
	calibrated_value?: number | null;
}

export interface GrabExistingReplicate {
	replicate_index: number;
	raw_value: number;
	calibrated_value: number | null;
	standard_curve_id: string | null;
}

export interface GrabExistingGroup {
	parameter_id: string;
	time: string;
	replicates: GrabExistingReplicate[];
}

export interface GrabSampleResponse {
	inserted: number;
	samples_created: number;
	created_sample_ids: string[];
	dry_run: boolean;
	replaced: number;
	preview: GrabPreviewRow[];
	existing_groups: GrabExistingGroup[];
}

export const saveGrabSample = (req: GrabSampleRequest) =>
	POST<GrabSampleResponse>(`${SERVICE}/grab_samples`, req);

// --- Seasonal check (the portal's Check gate) --------------------------------------------------

export interface SeasonalCheckValue {
	parameter_id: string;
	value: number;
}

export type SeasonalClass =
	| 'no_history'
	| 'below_min'
	| 'below_q10'
	| 'normal'
	| 'above_q90'
	| 'above_max';

export interface SeasonalFinding {
	parameter_id: string;
	value: number;
	class: SeasonalClass;
	warning: boolean;
	n: number;
	min: number | null;
	q10: number | null;
	q90: number | null;
	max: number | null;
	/** Pooled historical values (capped) for the distribution plot. */
	distribution: number[];
}

export interface SeasonalCheckResponse {
	check_id: string;
	findings: SeasonalFinding[];
	warnings: number;
}

/**
 * Screen entered values against the site's seasonal distribution (entry month ±2 across all
 * years, unflagged spot replicates pooled). The returned check_id gates the save: pass it on
 * saveGrabSample and the server holds the save to exactly the checked values.
 */
export const seasonalCheck = (req: { site_id: string; time: string; values: SeasonalCheckValue[] }) =>
	POST<SeasonalCheckResponse>(`${SERVICE}/readings/seasonal_check`, req);

/** Existing replicate groups from a grab-sample 409 body ({ error, detail }); null otherwise. */
export function grabConflictGroups(e: unknown): GrabExistingGroup[] | null {
	if (!(e instanceof ApiError) || e.status !== 409) return null;
	try {
		const body = JSON.parse(e.message) as { detail?: GrabExistingGroup[] };
		return Array.isArray(body.detail) ? body.detail : [];
	} catch {
		return [];
	}
}

// Schedules, the recurring-service control plane.
export type OverlapPolicy = 'skip_if_running' | 'allow_concurrent';
export type CatchupPolicy = 'run_once' | 'skip';

export interface Schedule {
	job_name: string;
	enabled: boolean;
	interval_seconds: number;
	next_run_at: string | null;
	last_enqueued_at: string | null;
	overlap_policy: OverlapPolicy;
	catchup_policy: CatchupPolicy;
	tunables: Record<string, unknown>;
	updated_by: string | null;
	updated_at: string;
	running: boolean;
}

export interface ScheduleAuditEntry {
	changed_at: string;
	changed_by: string | null;
	old_value: Record<string, unknown>;
	new_value: Record<string, unknown>;
}

export interface ScheduleUpdate {
	enabled?: boolean;
	interval_seconds?: number;
	overlap_policy?: OverlapPolicy;
	catchup_policy?: CatchupPolicy;
	tunables?: Record<string, unknown>;
}

export interface RunNowResponse {
	job_id: string | null;
	enqueued: boolean;
}

export const listSchedules = () => GET<Schedule[]>(`${ADMIN}/schedules`);

export const getSchedule = (jobName: string) =>
	GET<Schedule>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}`);

export const updateSchedule = (jobName: string, body: ScheduleUpdate) =>
	PATCH<Schedule>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}`, body);

export const runScheduleNow = (jobName: string) =>
	POST<RunNowResponse>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}/run_now`);

export const getScheduleAudit = (jobName: string) =>
	GET<ScheduleAuditEntry[]>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}/audit`);
