import { GET, POST, PATCH, PUT, DELETE } from './client';
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

// Notifications, channel capabilities (env-gated; carries no secrets). The frontend uses this to
// enable a channel or render it greyed-out with a "configured via environment" note.
export interface NotificationsConfig {
	// botUsername/botName/botDescription come from Telegram's getMe for the configured token, so
	// they always describe the bot actually in use rather than what config claims.
	telegram: {
		available: boolean;
		botUsername?: string;
		botName?: string;
		botDescription?: string;
	};
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
	telegram: {
		status: 'unlinked' | 'pending' | 'linked';
		code_expires_at?: string;
		linked_at?: string;
		last_used_at?: string;
		// When the link lapses unless its owner signs in again. Renewal is passive.
		attested_until?: string;
	};
	// Whether this link is held open against idle expiry. Administrator-settable only.
	expiry_exempt: boolean;
	subscriptions: MySubscriptionScope[];
}

export const getMyNotifications = () => GET<MyNotifications>(`${SERVICE}/notifications/me`);

export const updateMyNotifications = (body: {
	email_enabled?: boolean;
	telegram_enabled?: boolean;
	// Administrators only; the API rejects it for anyone else rather than ignoring it.
	expiry_exempt?: boolean;
}) => PATCH<MyNotifications>(`${SERVICE}/notifications/me`, body);

export const setMySubscriptions = (subscriptions: MySubscriptionScope[]) =>
	PUT<MyNotifications>(`${SERVICE}/notifications/me/subscriptions`, { subscriptions });

export const mintMyLinkCode = () =>
	POST<{ code: string; expires_at: string }>(`${SERVICE}/notifications/me/link_code`, {});

export const unlinkMyTelegram = () => DELETE<void>(`${SERVICE}/notifications/me/telegram`);

// Admin notification oversight, per-channel health probe (admin-only). `healthy` is null until a
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
	// Held open against idle expiry. Administrator-settable only.
	expiry_exempt: boolean;
	// When the link lapses unless its owner signs in to the dashboard again.
	attested_until?: string;
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
	parameter: {
		id: string | null;
		name: string;
		label: string | null;
		create: boolean;
		units: string;
		group_key: string | null;
		original_names: string[];
		replicates: PlanReplicateSummary | null;
	};
	confidence: string;
	warnings: string[];
	original_parameter_name: string | null;
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
	// Display label for a parameter the plan will create; ignored for matched existing parameters.
	parameter_label?: string;
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

// Replicate families: one stream per replicate group. The stream's metadata.replicates spec names
// the portal columns feeding replicate_index 0..n-1 and the portal's precomputed avg/sd columns,
// which are audited at sync time rather than stored.
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
export interface ReplicateAuditHold {
	id: string;
	stream_id: string;
	source_system: string;
	source_key: string;
	source_name: string | null;
	site_name: string | null;
	parameter_name: string | null;
	parameter_code: string | null;
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
	// What a remediation did: which replicate indexes were flagged, and why.
	resolution: { action?: string; replicate_indexes?: number[]; reason?: string | null } | null;
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
		page?: number;
		page_size?: number;
	} = {},
) => GET<ReplicateAuditListResponse>(`${ADMIN}/sync/replicate_audit_holds`, { ...filter });

export const acknowledgeReplicateAudit = (id: string) =>
	POST<{ acknowledged: number }>(`${ADMIN}/sync/replicate_audit_holds/${id}/acknowledge`, {});

export const acknowledgeReplicateAuditsBulk = (req: {
	stream_id?: string;
	source_system?: string;
	start?: string;
	end?: string;
	// Only acknowledge holds whose disagreements are at or below both ceilings (AND).
	max_mean_relative_delta?: number;
	max_sd_relative_delta?: number;
}) =>
	POST<{ acknowledged: number }>(`${ADMIN}/sync/replicate_audit_holds/acknowledge_bulk`, req);

// Resolve a pending hold. 'ours' records that the recomputed statistics stand. 'flag' flags the
// named replicate indexes; the sample's mean/sd/n recompute immediately from the rest. Statistics
// are never entered directly: only input data can be flagged.
export const resolveReplicateAudit = (
	id: string,
	body: { mode: 'ours' } | { mode: 'flag'; replicate_indexes: number[]; reason?: string },
) => POST<{ status: string }>(`${ADMIN}/sync/replicate_audit_holds/${id}/resolve`, body);

// Unflag a remediated hold's replicates and return it to review.
export const reopenReplicateAudit = (id: string) =>
	POST<{ status: string }>(`${ADMIN}/sync/replicate_audit_holds/${id}/reopen`, {});

export const getSyncCommand = (id: string) =>
	GET<SyncCommand>(`${ADMIN}/sync/commands/${id}`);

export const getPendingAuditCount = async (): Promise<number> =>
	(await listReplicateAudits({ page_size: 1 })).pending;

// Replicate reconciliation: migrate readings from legacy per-`_avg`-column streams onto their
// replicate-family streams (tracked job, migrate + verify, never deletes), then a separate
// re-verify + delete pass for the obsolete avg streams.
export interface ReconciliationFamily {
	family_stream_id: string;
	family_source_key: string;
	old_stream_id: string;
	old_source_key: string;
	site_parameter_id: string | null;
	old_readings: number;
	new_group_times: number;
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

// Grab samples
export interface GrabSampleReading {
	parameter_id: string;
	time: string;
	value: number;
	replicate_index?: number;
	sensor_id?: string;
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
	readings: GrabSampleReading[];
}

export interface GrabSampleResponse {
	inserted: number;
	samples_created: number;
}

export const saveGrabSample = (req: GrabSampleRequest) =>
	POST<GrabSampleResponse>(`${SERVICE}/grab_samples`, req);

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
