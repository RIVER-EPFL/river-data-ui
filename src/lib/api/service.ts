import { ApiError, GET, POST, PATCH, PUT, DELETE, getList } from './client';
import type { ApiToken, DataStream, JobLogLine, ReprocessingJob } from './crud';
import type { components } from './schema';

// Single unified API tier. The `ADMIN` and `SERVICE` constants alias the same path,
// retained as documentation hints about which Keycloak role/token scope each endpoint
// requires (see `require_admin` vs scoped middleware on the backend).
const ADMIN = '/api';
const SERVICE = '/api';

// Search
export type SearchResponse = components['schemas']['SearchResponse'];

export const search = (query: string) =>
	GET<SearchResponse>(`${ADMIN}/search`, { q: query });

// Build/version metadata of the running API (authenticated; requires read_metadata).
export type ApiVersion = components['schemas']['VersionInfo'];

export const getVersion = () => GET<ApiVersion>(`${SERVICE}/version`);

// Per-job timeline (reprocessing_job_logs). `afterSeq` tails new lines incrementally.
export const getJobLogs = (jobId: string, afterSeq?: number) =>
	GET<JobLogLine[]>(
		`${SERVICE}/reprocessing_jobs/${jobId}/logs${afterSeq != null ? `?after_seq=${afterSeq}` : ''}`,
	);

// Notifications: Web Push capability (env-gated).
// The Web Push capability the config endpoint answers with, which is served outside the private
// API's document.
export interface NotificationsConfig {
	webPush: { available: boolean; vapidPublicKey?: string };
}

export const getNotificationsConfig = () =>
	GET<NotificationsConfig>(`${SERVICE}/config/notifications`);

// Self-service notification preferences (the caller's own, bound to their JWT sub server-side).
export type MySubscriptionScope = components['schemas']['SubscriptionScope'];

export type MyNotifications = components['schemas']['MyNotifications'];

export const getMyNotifications = () => GET<MyNotifications>(`${SERVICE}/notifications/me`);

/** One channel as the settings page shows it: what it sends, and how often it has sent it. */
export type NotificationChannelView = components['schemas']['ChannelView'];

export const getNotificationChannels = () =>
	GET<NotificationChannelView[]>(`${SERVICE}/notifications/channels`);

export const updateMyNotifications = (body: { web_push_enabled?: boolean }) =>
	PATCH<MyNotifications>(`${SERVICE}/notifications/me`, body);

export const setMySubscriptions = (subscriptions: MySubscriptionScope[]) =>
	PUT<MyNotifications>(`${SERVICE}/notifications/me/subscriptions`, { subscriptions });

// The push subscription rows the me-routes answer with; the document describes the register
// request, not the stored row.
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

// One delivery attempt as the health panel reads it, assembled here from the delivery log.
export interface PushAttempt {
	id: string;
	endpointTail: string;
	userAgent?: string;
	status: 'sent' | 'failed';
	error?: string;
	pruned: boolean;
}

export const testMyPush = () =>
	POST<PushAttempt[]>(`${SERVICE}/notifications/me/push/test`, {});

export const scheduleMyPing = (seconds: number = 10) =>
	POST<{ seconds: number }>(`${SERVICE}/notifications/me/push/ping`, { seconds });

// Admin notification oversight.
/** The API's `ChannelHealth`. */
export type ChannelHealth = components['schemas']['ChannelHealth'];

/** The API's `NotificationHealth`. */
export type NotificationHealth = components['schemas']['NotificationHealth'];

export const getNotificationsHealth = () =>
	GET<NotificationHealth>(`${ADMIN}/notifications/health`);

export const refreshNotificationsHealth = () =>
	POST<NotificationHealth>(`${ADMIN}/notifications/health/refresh`, {});

export type TestSendResult = components['schemas']['TestSendResponse'];

export const testSend = (body: { channel: string; recipient: string }) =>
	POST<TestSendResult>(`${ADMIN}/notifications/test-send`, body);

export type NotificationSubscriber = components['schemas']['SubscriberRow'];

export const getNotificationSubscribers = () =>
	GET<NotificationSubscriber[]>(`${ADMIN}/notifications/subscribers`);

/** The API's `DeliveryRecipient`. */
export type DeliveryRecipient = components['schemas']['DeliveryRecipient'];

/** The API's `DeliveryMessage`. */
export type DeliveryMessage = components['schemas']['DeliveryMessage'];

/** One page of rows and nothing else, the shape a list answers in when it carries no subject. */
export interface Page<T> {
	items: T[];
	/** Rows matching the filter, not rows on this page. */
	total: number;
	page: number;
	page_size: number;
}

export const getNotificationDeliveries = (params: {
	limit?: number;
	offset?: number;
	status?: string;
	kind?: string;
}) => {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== '') q.set(k, String(v));
	}
	const qs = q.toString();
	return GET<Page<DeliveryMessage>>(`${ADMIN}/notifications/deliveries${qs ? `?${qs}` : ''}`);
};

// Alarms
export type ActiveAlarm = components['schemas']['ActiveAlarm'];

export type AcknowledgedAlarmResponse = components['schemas']['AcknowledgedAlarmResponse'];

export type ActiveAlarmsResponse = components['schemas']['ActiveAlarmsResponse'];

export type AlarmSummaryResponse = components['schemas']['AlarmSummaryResponse'];

export type AlarmEvent = components['schemas']['AlarmEventResponse'];

export type AlarmEventsResponse = components['schemas']['AlarmEventsResponse'];

export const getActiveAlarms = () => GET<ActiveAlarmsResponse>(`${ADMIN}/alarms/active`);
export const getAlarmSummary = () => GET<AlarmSummaryResponse>(`${ADMIN}/alarms/summary`);

/** A threshold resolved per (site, parameter) by the backend's one definition of the two tiers,
 *  with the slot's latest value beside it. */
export type ThresholdWithValue = components['schemas']['ThresholdWithValue'];

/** The effective threshold per active sensor (site_parameter). The UI never re-resolves the tiers. */
export const getThresholds = (opts?: { site_id?: string; parameter_id?: string }) =>
	GET<ThresholdWithValue[]>(`${ADMIN}/alarms/thresholds`, opts);

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
export type StreamStats = components['schemas']['StreamStatsResponse'];

export const getStreamStats = (streamId: string) =>
	GET<StreamStats>(`${SERVICE}/streams/${streamId}/stats`);

// One windowed-ingest pass over a stream: what was submitted and what the diff did. The ledger
// carries the whole row; the provenance record's origin carries the summary, which is the same
// counts without the funnel's `retained` and `dropped`.
export type StreamReceipt = components['schemas']['ReceiptRow'];
export type ReceiptSummary = components['schemas']['ReceiptSummary'];

export type StreamReceiptsResponse = components['schemas']['ReceiptsResponse'];

export const listStreamReceipts = (streamId: string, page = 1, pageSize = 50) =>
	GET<StreamReceiptsResponse>(`${SERVICE}/streams/${streamId}/receipts`, {
		page,
		page_size: pageSize,
	});

/** Readings the pairing backfilled attribution onto. */
export type PairStreamResult = components['schemas']['PairStreamResponse'];

/** Readings the unpairing stripped attribution from. */
export type UnpairStreamResult = components['schemas']['UnpairStreamResponse'];

export const pairStream = (streamId: string, siteParameterId: string) =>
	POST<PairStreamResult>(`${SERVICE}/streams/${streamId}/pair`, { site_parameter_id: siteParameterId });

export const unpairStream = (streamId: string) =>
	POST<UnpairStreamResult>(`${SERVICE}/streams/${streamId}/unpair`);

export type PreviewReplicate = components['schemas']['PreviewReplicate'];

export type PreviewInstant = components['schemas']['PreviewInstant'];

export type StreamPreview = components['schemas']['StreamPreviewResponse'];

/** The stream's most recent instants as the replicate rows pairing will serve them as. */
export const getStreamPreview = (streamId: string, limit = 3) =>
	GET<StreamPreview>(`${ADMIN}/streams/${streamId}/preview?limit=${limit}`);

export type ImportStreamResponse = components['schemas']['ImportStreamResponse'];

/** Import a stream's device into the sensor inventory (creates the sensor and stamps its existing
 *  readings) WITHOUT pairing it to a site. Separate from pairing/adopt. No curve is created: the
 *  readings resolve whatever calibration windows the sensor already has, which may be none. */
export const importStream = (streamId: string) =>
	POST<ImportStreamResponse>(`${SERVICE}/streams/${streamId}/import`, {});

// Actions. A route that enqueues one job answers with the row it enqueued.
export type QueuedJobResponse = components['schemas']['QueuedJobResponse'];
export type RecalculateResponse = components['schemas']['RecalculateResponse'];
export type ReconcileAlarmsResponse = components['schemas']['ReconcileAlarmsResponse'];
export type InvalidatedConfigResponse = components['schemas']['InvalidatedConfigResponse'];
export type ReprocessAllResponse = components['schemas']['ReprocessAllResponse'];

export const recalibrateCalibration = (id: string) =>
	POST<RecalculateResponse>(`${ADMIN}/actions/sensor_calibrations/${id}/recalculate`);

export const rollbackDeployment = (deploymentId: string) =>
	POST<{ status: string; readings_reassigned: number; previous_deployment_id: string | null }>(
		`${ADMIN}/actions/rollback_deployment`,
		{ deployment_id: deploymentId },
	);

export const recomputeDerived = (id: string) =>
	POST<QueuedJobResponse>(`${ADMIN}/actions/derived_parameters/${id}/recompute`);

export const refreshAggregates = (full = false) =>
	POST<QueuedJobResponse>(`${SERVICE}/actions/refresh_aggregates`, { full });

export const invalidatePublicConfig = (code: string) =>
	POST<InvalidatedConfigResponse>(`${ADMIN}/actions/invalidate_public_config/${code}`);

// The group definition: the members a group renders, in the group's own order.
export type GroupDefinitionMember = components['schemas']['DefinitionMember'];

export type GroupDefinition = components['schemas']['GroupDefinition'];

export const getGroupDefinition = (groupId: string, siteId?: string) =>
	GET<GroupDefinition>(`${SERVICE}/parameter_groups/${groupId}/definition`, { site_id: siteId });

// Merge parameters
export type MergeParametersResponse = components['schemas']['MergeParametersResponse'];

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
export type MergeSiteParametersResponse = components['schemas']['MergeSiteParametersResponse'];

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
	POST<QueuedJobResponse>(`${SERVICE}/actions/reprocess`, { sensor_id: sensorId });

// Backdate: re-derive every (site, parameter) slot from the deployment and calibration timelines.
export const reprocessAll = () => POST<ReprocessAllResponse>(`${SERVICE}/actions/reprocess_all`, {});

// Reconcile persisted alarm events against the breach set the readings currently imply.
export const reconcileAlarms = () =>
	POST<ReconcileAlarmsResponse>(`${SERVICE}/actions/reconcile_alarms`, {});

export type AdoptSuggestion = components['schemas']['AdoptSuggestion'];

// Suggested deploy dates for a sensor: now, the end of its last deployment, and its first reading.
export const getAdoptSuggestions = (sensorId: string) =>
	GET<AdoptSuggestion>(`${SERVICE}/sensors/${sensorId}/adopt_suggestions`);

export type AdoptResponse = components['schemas']['AdoptResponse'];

/**
 * Deploy a sensor onto a site slot. Does in one transaction what a bare `sensor_deployments`
 * create cannot: mints the missing `site_parameters` row, resolves the parameter from the sensor's
 * own history when it is unambiguous, lifts the decompression cap for the readings backfill, and
 * returns the tracked reprocess job.
 */
export const adoptSensor = (
	sensorId: string,
	body: {
		site_id: string;
		parameter_id?: string;
		deployed_from?: string;
		create_site_parameter?: boolean;
	},
) => POST<AdoptResponse>(`${SERVICE}/sensors/${sensorId}/adopt`, body);

export type SwapResponse = components['schemas']['SwapResponse'];

// End the outgoing instrument's deployment and start the incoming one's at the same instant.
export type SensorVsGrabRow = components['schemas']['SensorVsGrabRow'];

export type SensorVsGrabResponse = components['schemas']['SensorVsGrabResponse'];

// Each grab value against the continuous average over a window after it, the portals' comparison.
export const getSensorVsGrab = (
	siteId: string,
	q: {
		parameter_id: string;
		start?: string;
		end?: string;
		window_start_hours?: number;
		window_end_hours?: number;
	},
) => {
	const params = new URLSearchParams({ parameter_id: q.parameter_id });
	if (q.start) params.set('start', q.start);
	if (q.end) params.set('end', q.end);
	if (q.window_start_hours != null) params.set('window_start_hours', String(q.window_start_hours));
	if (q.window_end_hours != null) params.set('window_end_hours', String(q.window_end_hours));
	return GET<SensorVsGrabResponse>(`${SERVICE}/sites/${siteId}/export/sensor-vs-grab?${params}`);
};

export const swapSensors = (body: {
	outgoing_sensor_id: string;
	incoming_sensor_id: string;
	site_id: string;
	parameter_id?: string;
	at?: string;
	create_site_parameter?: boolean;
}) => POST<SwapResponse>(`${SERVICE}/actions/swap`, body);

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

// Replay a finished tracked job from the params stored on its row. Returns a new job.
export const rerunJob = (jobId: string) =>
	POST<{ job_id: string; status: string }>(`${SERVICE}/reprocessing_jobs/${jobId}/rerun`, {});

// Cooperatively cancel a running job. Takes effect at the job's next batch checkpoint.
export const cancelJob = (jobId: string) =>
	POST<{ status: string }>(`${SERVICE}/reprocessing_jobs/${jobId}/cancel`, {});

// Bulk historical attribution: list open deployments with claimable pre-deployment history.
export type BackfillCandidate = components['schemas']['BackfillCandidate'];
export type BackfillSiteSummary = components['schemas']['BackfillSiteSummary'];
export type BackfillCandidatesResponse = components['schemas']['BackfillCandidatesResponse'];
export const getBackfillCandidates = () =>
	GET<BackfillCandidatesResponse>(`${SERVICE}/actions/backfill_candidates`);

export type BackfillAttributionResponse = components['schemas']['BackfillAttributionResponse'];
// Backdate the matching open deployments + window-reprocess so historical orphans get attributed.
export const backfillAttribution = (body: { all?: boolean; site_id?: string; deployment_ids?: string[] }) =>
	POST<BackfillAttributionResponse>(`${SERVICE}/actions/backfill_attribution`, body);

// Readings a calibration window covers that were never stamped with it. A reprocess resolves them
// against the curves that already exist; nothing is created.
export type CalibrationBackfillCandidate = components['schemas']['CalibrationBackfillCandidate'];
// Readings whose calibrated_value differs from raw_value while naming neither a calibration nor a
// standard curve. Reported only - the stored number is somebody's measurement.
export type OrphanedCorrection = components['schemas']['OrphanedCorrection'];
export type CalibrationBackfillCandidatesResponse =
	components['schemas']['CalibrationBackfillCandidatesResponse'];
export const getCalibrationCandidates = () =>
	GET<CalibrationBackfillCandidatesResponse>(`${SERVICE}/actions/calibration_candidates`);

export type BackfillCalibrationsResponse = components['schemas']['BackfillCalibrationsResponse'];
export const backfillCalibrations = (body: { all?: boolean; sensor_id?: string; sensor_ids?: string[] }) =>
	POST<BackfillCalibrationsResponse>(`${SERVICE}/actions/backfill_calibrations`, body);

// Derived preview
export type PreviewDerivedRequest = components['schemas']['PreviewDerivedRequest'];

export type PreviewDerivedResponse = components['schemas']['PreviewDerivedResponse'];

export const previewDerived = (params: PreviewDerivedRequest) =>
	POST<PreviewDerivedResponse>(`${ADMIN}/actions/preview_derived`, params);

// Export summary: what a site export of this range can carry beyond the plain series.
export type ExportSummary = components['schemas']['ExportSummaryResponse'];

export const getSiteExportSummary = (siteId: string, start: string, end: string) =>
	GET<ExportSummary>(`${SERVICE}/sites/${siteId}/export/summary`, { start, end });

// Instruments overview: every instrument owning curves or feeding streams, with usage.
export type CurveOverview = components['schemas']['CurveOverview'];

export type InstrumentStreamRef = components['schemas']['InstrumentStreamRef'];

export type InstrumentOverview = components['schemas']['InstrumentOverview'];

export const getInstrumentsOverview = () =>
	GET<{ instruments: InstrumentOverview[] }>(`${SERVICE}/instruments/overview`);

export type CurveUsagePoint = components['schemas']['CurveUsagePoint'];

export type CurveUsageResponse = components['schemas']['CurveUsageResponse'];

export const getCurveUsage = (curveId: string) =>
	GET<CurveUsageResponse>(`${SERVICE}/standard_curves/${curveId}/usage`);

// The instrument and standard curve the newest grab at a site and parameter recorded; every
// field but `method` is null when no grab there names either.
export type LastUsedCurve = components['schemas']['LastUsedCurveResponse'];

export const getLastUsedCurve = (
	siteId: string,
	by: { parameterId?: string | null; parameterCode?: string | null },
) =>
	GET<LastUsedCurve>(
		`${SERVICE}/sites/${siteId}/last_curve`,
		by.parameterId ? { parameter_id: by.parameterId } : { parameter_code: by.parameterCode ?? '' },
	);

// One instrument's curve usage, the figures the overview reports without reading every instrument.
export type SensorCurveUsage = components['schemas']['SensorCurveUsage'];

export const getSensorCurveUsage = (sensorId: string) =>
	GET<{ sensor_id: string; usage: SensorCurveUsage[] }>(`${SERVICE}/sensors/${sensorId}/curve_usage`);

// Retiring a curve. A calibration's retirement moves the readings it corrected onto whatever else
// covers them, so the action states what it will do before it runs; a standard curve's changes no
// stored value and only takes it out of the picker. Both are reversible.
export type CalibrationRetirement = components['schemas']['RetireResponse'];

export const previewCalibrationRetirement = (calibrationId: string) =>
	POST<CalibrationRetirement>(`${SERVICE}/sensor_calibrations/${calibrationId}/retire`, {
		dry_run: true,
	});

export const retireCalibration = (calibrationId: string, reason?: string) =>
	POST<CalibrationRetirement>(`${SERVICE}/sensor_calibrations/${calibrationId}/retire`, {
		...(reason ? { reason } : {}),
	});

export const unretireCalibration = (calibrationId: string) =>
	POST<{ calibration_id: string; sensor_id: string; set_id: string | null; restored: number }>(
		`${SERVICE}/sensor_calibrations/${calibrationId}/unretire`,
		{},
	);

export type StandardCurveRetirement = components['schemas']['RetireCurveResponse'];

export const retireStandardCurve = (curveId: string, reason?: string) =>
	POST<StandardCurveRetirement>(`${SERVICE}/standard_curves/${curveId}/retire`, {
		...(reason ? { reason } : {}),
	});

export const unretireStandardCurve = (curveId: string) =>
	POST<StandardCurveRetirement>(`${SERVICE}/standard_curves/${curveId}/unretire`, {});

// Sync
export type SyncService = components['schemas']['SyncServiceResponse'];

export type SyncCommand = components['schemas']['SyncCommandResponse'];

/// The `source_audit` command's result: everything a source holds against everything registered
/// here, per group. Per-cycle reconciliation only ever sees registered streams, so a channel the
/// connector declined and a group with no stream are outside every window and named on no receipt.
// Hand-written on purpose: this is a sync command's `result`, which is whatever the command it
// answers reports, so the document can only say "an object".
export interface SourceAuditReport {
	source_system: string;
	totals: {
		candidates: number;
		declined: number;
		registered: number;
		matched: number;
		unregistered: number;
		orphaned: number;
		unpaired: number;
	};
	groups: {
		name: string;
		candidates: number;
		registered: number;
		matched: number;
		unregistered: string[];
		orphaned: string[];
		unpaired: string[];
	}[];
	declined: { channel: string; reason: string }[];
	curves: {
		at_source: number;
		registered: number;
		unregistered: string[];
		orphaned: string[];
	};
}

export type SyncEvent = components['schemas']['SyncEventResponse'];

export type SyncServiceCredential = components['schemas']['CredentialResponse'];

export const issueSyncCommand = (serviceId: string, command: string, payload?: object) =>
	POST<SyncCommand>(`${ADMIN}/sync/services/${serviceId}/commands`, { command, payload });

// Null clears the override, returning the service to its own configured cadence. The service
// adopts the change on its next heartbeat.
export const setSyncInterval = (serviceId: string, seconds: number | null) =>
	PATCH<SyncService>(`${ADMIN}/sync/services/${serviceId}`, { sync_interval_secs: seconds });

// Whether the weekly sync_full_reassert job queues a full sync for this service.
export const setFullReassert = (serviceId: string, enabled: boolean) =>
	PATCH<SyncService>(`${ADMIN}/sync/services/${serviceId}`, { full_reassert_enabled: enabled });

export const createServiceCredential = (serviceType: string, sourceSystem?: string) =>
	POST<{ client_id: string; client_secret: string }>(`${ADMIN}/sync/credentials`, {
		service_type: serviceType,
		source_system: sourceSystem || null,
	});

export type RevokedResponse = components['schemas']['RevokedResponse'];

export const revokeSyncService = (credentialId: string) =>
	POST<RevokedResponse>(`${ADMIN}/sync/credentials/${credentialId}/revoke`);

// Pairing plans
export type PairingPlanEntry = components['schemas']['PlanEntry'];

// A catalog parameter an entry collides with, and what already depends on it. "Exists" alone does
// not say where or whether anything uses it, which is what decides a units conflict.
export type ExistingParamRef = components['schemas']['ExistingParamRef'];

export type PlanWarning = components['schemas']['PlanWarning'];

export type PlanCurveRef = components['schemas']['PlanCurveRef'];

export type PlanInstrumentRef = components['schemas']['PlanInstrumentRef'];

// Replicate-family summary on a plan entry: how the portal's columns route into one stream.
export type PlanReplicateSummary = components['schemas']['PlanReplicates'];

/** The counts a plan's review reads, as the API's `PlanSummary`. */
export type PairingPlanSummary = components['schemas']['PlanSummary'];

export type PairingPlan = components['schemas']['PairingPlan'];

export type PairingPlanApplyResult = components['schemas']['ApplyResult'];

// The PATCH body's per-entry update, as the route's own request struct. `sd_estimator` is a string
// on the wire because an empty one clears the choice and leaves the slot undeclared.
export type PlanEntryUpdate = components['schemas']['PlanEntryUpdate'];

export const createPairingPlan = (sourceSystem: string) =>
	POST<PairingPlan>(`${ADMIN}/sync/pairing-plans`, { source_system: sourceSystem });

export const getPairingPlan = (id: string) =>
	GET<PairingPlan>(`${ADMIN}/sync/pairing-plans/${id}`);

export type SiteMetadata = components['schemas']['PlanSiteMetadata'];

export const getPlanSiteMetadata = (planId: string) =>
	GET<SiteMetadata[]>(`${ADMIN}/sync/pairing-plans/${planId}/site-metadata`);

// One instrument decision in a plan: what it covers and the curves it owns. Only instruments the
// plan binds are listed; the rest of the inventory is reachable through the picker.
export type PlanInstrumentGroup = components['schemas']['PlanInstrumentGroup'];

export type InstrumentNameConflict = components['schemas']['InstrumentNameConflict'];

/** Hand-written: `InstrumentNameConflict` derives both Serialize and Deserialize, so P63's
 * rule left its `source_system` optional where the wire always carries the key. */
export type PlanUnassignedParameter = components['schemas']['PlanUnassignedParameter'];

// A standard curve the source replicated, and the instrument it is currently fitted on.
export type PlanCurveAssignment = components['schemas']['PlanCurveAssignment'];

// A curve assigned to an instrument the plan will create; the move happens on apply. A null
// `instrument_source_key` clears the assignment, where the stored `PlanCurveIntent` always names
// an instrument.
export type PlanCurveUpdate = components['schemas']['PlanCurveUpdate'];

// One physical device the plan's feeds name, and the channels it serves at one site. Not a
// decision: the serial is the identity, and pairing attaches it and opens the site slot's
// deployment.
export type PlanDeviceGroup = components['schemas']['PlanDeviceGroup'];

export type PlanInstruments = components['schemas']['PlanInstrumentsResponse'];

export const getPlanInstruments = (planId: string) =>
	GET<PlanInstruments>(`${ADMIN}/sync/pairing-plans/${planId}/instruments`);

// Every write names the version it read: a second reviewer on the same draft is refused with a
// 409 rather than carrying this client's entries back over theirs.
export const updatePairingPlan = (
	id: string,
	expectedVersion: number,
	updates: PlanEntryUpdate[],
	curves: PlanCurveUpdate[] = [],
) =>
	PATCH<PairingPlan>(`${ADMIN}/sync/pairing-plans/${id}`, {
		expected_version: expectedVersion,
		updates,
		curves,
	});

// A plan-wide decision: the server selects on the predicate and applies the action, so the round
// trip is one predicate rather than one line per entry.
export const bulkUpdatePairingPlan = (
	id: string,
	expectedVersion: number,
	bulk: { where: { confidence?: string; has_warnings?: boolean }; action: 'pair' | 'skip' },
) =>
	PATCH<PairingPlan>(`${ADMIN}/sync/pairing-plans/${id}`, {
		expected_version: expectedVersion,
		bulk,
	});

// Apply/revert now run as tracked background jobs; both return a job id to poll.
export const applyPairingPlan = (id: string, expectedVersion: number) =>
	POST<{ job_id: string; status: string }>(`${ADMIN}/sync/pairing-plans/${id}/apply`, {
		expected_version: expectedVersion,
	});

export const revertPairingPlan = (id: string) =>
	POST<{ job_id: string; status: string }>(`${ADMIN}/sync/pairing-plans/${id}/revert`);

// What the wait looks like right now, in one phrase. A failed attempt puts the row back to
// `queued` with `retry_count` bumped, so a retrying job and one that has never run read alike
// unless the count is read with the status.
export function jobWaitLabel(job: ReprocessingJob): string {
	if (job.status === 'queued' && job.retry_count > 0) {
		const attempt = job.retry_count + 1;
		return job.error_message
			? `Retrying after ${job.error_message} (attempt ${attempt})`
			: `Retrying (attempt ${attempt})`;
	}
	if (job.status === 'queued') return 'Queued';
	if (job.status === 'running' && job.total) return `Running (${job.progress ?? 0} of ${job.total})`;
	return job.status === 'running' ? 'Running' : job.status;
}

// Poll a tracked job until it completes, reporting each row it reads through `onTick` so the
// caller can render the wait. A terminal state that is not `completed` throws the job's own
// error, which is what the operator needs to read; the timeout is for a job that never lands.
export async function pollJob(
	jobId: string,
	opts: {
		intervalMs?: number;
		timeoutMs?: number;
		onTick?: (job: ReprocessingJob) => void;
	} = {},
): Promise<ReprocessingJob> {
	const intervalMs = opts.intervalMs ?? 1000;
	const timeoutMs = opts.timeoutMs ?? 600_000;
	const start = Date.now();
	const terminal = new Set(['failed', 'cancelled', 'interrupted']);
	for (;;) {
		const job = await GET<ReprocessingJob>(`${SERVICE}/reprocessing_jobs/${jobId}`);
		opts.onTick?.(job);
		if (job.status === 'completed') return job;
		if (terminal.has(job.status)) {
			throw new Error(job.error_message ?? `Job ${job.status}`);
		}
		if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for job');
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

// A plan without its entries. A CNET draft carries 1891 entries and a NOMIS one 29,400, so the
// listing that answers "is there a draft to go back to" never asks for them.
export type PairingPlanListing = Omit<PairingPlan, 'entries' | 'apply_result'> & {
	/** Streams unpaired now that the plan does not name; null on anything but a draft. */
	uncovered_streams: number | null;
};

export const listPairingPlans = (params: { source_system?: string; status?: string } = {}) => {
	const q = new URLSearchParams();
	if (params.source_system) q.set('source_system', params.source_system);
	if (params.status) q.set('status', params.status);
	const query = q.toString();
	return GET<PairingPlanListing[]>(`${ADMIN}/sync/pairing-plans${query ? `?${query}` : ''}`);
};

export const supersedePairingPlan = (id: string) =>
	POST<{ id: string; status: string }>(`${ADMIN}/sync/pairing-plans/${id}/supersede`, {});

export const getUnpairedSummary = () =>
	GET<{ source_system: string; unpaired: number; paired: number }[]>(
		`${ADMIN}/sync/unpaired-summary`,
	);

// Replicate families: one stream per replicate group. The stream's metadata.replicates spec names
// the portal columns feeding the stream (a reading's replicate_index is its column's position in
// source_columns; a column with no value at an instant leaves that index absent, so a group can
// lack index 0) and the portal's precomputed avg/sd columns, which are audited at sync time
// rather than stored.
export type ReplicateSpec = components['schemas']['ReplicateSpec'];

/** The replicate-family spec carried in a stream's metadata, or null for ordinary streams. */
export function replicateSpec(stream: DataStream): ReplicateSpec | null {
	const raw = stream.metadata?.['replicates'];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const spec = raw as Record<string, unknown>;
	if (!Array.isArray(spec.source_columns)) return null;
	return raw as unknown as ReplicateSpec;
}

// One stored value with the replicate index it is stored at, which is the source's column
// position and the only handle a flag can name. A hold recorded before the index travelled with
// the value carries the bare number instead.
export type ReplicateAuditValue = components['schemas']['HoldValue'];

// A replicate group whose recomputed mean/sd disagrees with the portal's stored avg/sd. The group
// is stored and served (our recomputed statistics); the hold queues the disagreement for review.
export type HoldKind =
	| 'replicate_stats'
	| 'source_modified'
	| 'brake_fired'
	| 'missing_output'
	| 'stale_output'
	| 'skipped_output'
	| 'curve_claim_stripped';

// The document carries the three statistics blobs as the structs their writer builds; `kind`,
// `status` and `classification` are strings there and the closed sets the panel branches on here,
// and `resolution` stays free JSON on the row.
export type ReplicateAuditHold = Omit<
	components['schemas']['HoldRow'],
	'kind' | 'status' | 'classification' | 'resolution'
> & {
	kind: HoldKind;
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
};

// The generated response with the narrowed hold above in place of the document's own.
export type ReplicateAuditListResponse = Omit<
	components['schemas']['ListHoldsResponse'],
	'holds'
> & { holds: ReplicateAuditHold[] };


// Omitting `status` returns live holds. `status` also accepts the meta-value 'resolved'
// (everything past review) and 'deferred' (unpaired streams).
export const listReplicateAudits = (
	filter: {
		// One hold, for a link that names it.
		id?: string;
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
export type AcknowledgeResult = components['schemas']['AcknowledgeResponse'];

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
export type SdEstimator = components['schemas']['SdEstimator'];

export type ResolveHoldResult = components['schemas']['ResolveHoldResponse'];

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
export type UndeclaredEstimatorSlot = components['schemas']['UndeclaredEstimatorSlot'];

export type UndeclaredEstimatorsResponse = components['schemas']['UndeclaredEstimatorsResponse'];

export const listUndeclaredSdEstimators = () =>
	GET<UndeclaredEstimatorsResponse>(`${ADMIN}/actions/undeclared_sd_estimators`);

export type CurationDriftResponse = components['schemas']['CurationDriftResponse'];
export type CurationDriftRow = components['schemas']['CurationDriftRow'];

// Readings whose curation columns are not the fold of the decisions recorded against them.
// Read-only: which side is wrong is itself a decision.
export const getCurationDrift = (limit?: number) =>
	GET<CurationDriftResponse>(`${ADMIN}/actions/curation_drift${limit ? `?limit=${limit}` : ''}`);

export type DeclareSdEstimatorResponse = components['schemas']['DeclareSdEstimatorResponse'];

// The one path for changing a slot's declaration: writes the column and enqueues the tracked
// retag recomputing the slot's stored samples. The CRUD update excludes the field.
export const declareSdEstimator = (siteParameterId: string, estimator: SdEstimator | null) =>
	POST<DeclareSdEstimatorResponse>(
		`${ADMIN}/site_parameters/${siteParameterId}/declare_sd_estimator`,
		{ estimator },
	);

export type RetagSdEstimatorResponse = components['schemas']['RetagSdEstimatorResponse'];

// The sd_estimator_retag job's own options: bring stored samples into line with a declaration
// the slot already carries, optionally over a window, optionally overriding instant decisions.
// dry_run counts without enqueueing and skips the declaration check, so it previews a change.
export const retagSdEstimator = (body: {
	estimator: SdEstimator;
	site_parameter_ids?: string[];
	stream_ids?: string[];
	start?: string;
	end?: string;
	override_instants?: boolean;
	dry_run?: boolean;
}) => POST<RetagSdEstimatorResponse>(`${ADMIN}/actions/retag_sd_estimator`, body);

export type SamplePreviewStats = components['schemas']['PreviewStats'];

export type SamplePreviewResponse = components['schemas']['SamplePreviewResponse'];

// What a replicate group's statistics become without the replicates about to be flagged, with
// the ones about to be restored, or under the other divisor. Writes nothing.
export const previewSample = (body: {
	stream_id?: string;
	site_id?: string;
	parameter_id?: string;
	time: string;
	exclude_replicate_indexes?: number[];
	include_replicate_indexes?: number[];
	estimator?: SdEstimator;
	hold_id?: string;
}) => POST<SamplePreviewResponse>(`${ADMIN}/readings/sample_preview`, body);

// Unflag a remediated hold's replicates and return it to review.
export const reopenReplicateAudit = (id: string) =>
	POST<{ status: string }>(`${ADMIN}/sync/replicate_audit_holds/${id}/reopen`, {});

export const getSyncCommand = (id: string) =>
	GET<SyncCommand>(`${ADMIN}/sync/commands/${id}`);

/** Pending review items and their per-kind breakdown, for the entry-point wording. */
export const getPendingAuditSummary = async (): Promise<{ pending: number; byKind: Record<string, number> }> => {
	const res = await listReplicateAudits({ page_size: 1 });
	return { pending: res.pending, byKind: res.pending_by_kind ?? {} };
};

// Provenance: the assembled record of one measured instant.

export type ProvenanceCalibrationRef = components['schemas']['CalibrationRef'];

export type ProvenanceCurveRef = components['schemas']['CurveRef'];

export type ProvenanceReading = components['schemas']['ReadingFacet'];

export type ProvenanceOrigin = components['schemas']['OriginInfo'];

export type ProvenanceChain = components['schemas']['ChainInfo'];

// The formula behind a derived value: the definition, and the version the value was made with.
// A value stored before versioning names no version, so no formula is reported for it: today's
// text is not what produced it.
export type ProvenanceCalculation = components['schemas']['CalculationInfo'];

export type ProvenanceRecord = components['schemas']['ProvenanceRecord'];

export type ProvenanceResponse = components['schemas']['ProvenanceResponse'];

// Either { stream_id } or { site_id, parameter_id }, plus the exact reading timestamp.
export const getReadingProvenance = (key: {
	time: string;
	stream_id?: string;
	site_id?: string;
	parameter_id?: string;
	measurement_type?: string;
}) => GET<ProvenanceResponse>(`${SERVICE}/readings/provenance`, { ...key });

// Visits: the portal's wide data row per (site, date).

export type VisitCell = components['schemas']['VisitCell'];

export type VisitRow = components['schemas']['VisitRow'];

export type VisitsResponse = components['schemas']['VisitsResponse'];

export const listSiteVisits = (
	siteId: string,
	opts: { start?: string; end?: string; page?: number; page_size?: number } = {},
) => GET<VisitsResponse>(`${SERVICE}/sites/${siteId}/visits`, { ...opts });

// The cross-site visits list: the counts without the cells, sortable server-side.

export type VisitListRow = components['schemas']['VisitListRow'];

export type VisitListSort = 'collected_at' | 'parameters_filled' | 'findings_open' | 'site_name';

export const listVisits = (
	opts: {
		site_id?: string;
		start?: string;
		end?: string;
		page?: number;
		page_size?: number;
		sort?: VisitListSort;
		order?: 'asc' | 'desc';
	} = {},
) => GET<Page<VisitListRow>>(`${SERVICE}/visits`, { ...opts });

export type EventCellReplicate = components['schemas']['CellReplicate'];

export type EventCell = components['schemas']['EventCell'];

export type EventDetailResponse = components['schemas']['EventDetailResponse'];

export const getCollectionEventDetail = (id: string) =>
	GET<EventDetailResponse>(`${SERVICE}/collection_events/${id}/detail`);

export type StagedEvent = components['schemas']['StagedEvent'];

/** Stage a field visit, or adopt the one already standing at that (site, instant). */
export const stageCollectionEvent = (req: { site_id: string; collected_at: string; notes?: string }) =>
	POST<StagedEvent>(`${SERVICE}/collection_events/stage`, req);

export const recomputeCollectionEvent = (id: string) =>
	POST<{ job_id: string | null }>(`${SERVICE}/collection_events/${id}/recompute`, {});

export const runEventAudit = (req: { site_id?: string; collection_event_id?: string }) =>
	POST<{ job_id: string | null }>(`${SERVICE}/actions/event_audit`, req);

/** The scoped apply: recompute every manual visit in a site and/or range, or only those with open findings. */
export const runEventRecompute = (req: {
	site_id?: string;
	start?: string;
	end?: string;
	only_findings?: boolean;
}) => POST<{ job_id: string | null }>(`${SERVICE}/actions/event_recompute`, req);

// Replicate reconciliation: migrate readings from legacy per-`_avg`-column streams onto their
// replicate-family streams (tracked job, migrate + verify, never deletes), then a separate
// re-verify + delete pass for the obsolete avg streams.
export type ReconciliationFamily = components['schemas']['FamilyCandidate'];

export type ReconciliationCandidatesResponse = components['schemas']['CandidatesResponse'];

export const getReconciliationCandidates = (sourceSystem: string) =>
	GET<ReconciliationCandidatesResponse>(`${ADMIN}/sync/replicate_reconciliation/candidates`, {
		source_system: sourceSystem,
	});

export const startReplicateReconciliation = (sourceSystem: string, dryRun = false) =>
	POST<{ job_id: string }>(`${ADMIN}/sync/replicate_reconciliation`, {
		source_system: sourceSystem,
		...(dryRun ? { dry_run: true } : {}),
	});

export type DuplicateSlotStream = components['schemas']['DuplicateSlotStream'];

export type DuplicateSlot = components['schemas']['DuplicateSlot'];

export const getDuplicateSlots = () =>
	GET<{ slots: DuplicateSlot[] }>(`${ADMIN}/sync/replicate_reconciliation/duplicate_slots`);

/** A value the source changed after river-data stored it, awaiting a decision (Q84). */
export type ChangeProposal = components['schemas']['Proposal'];

export type ProposalDecisionResult = components['schemas']['DecideResponse'];

export const getChangeProposals = (params: { status?: string; stream_id?: string } = {}) =>
	GET<ChangeProposal[]>(`${ADMIN}/sync/change_proposals`, { ...params });

export const decideChangeProposals = (
	ids: string[],
	decision: 'accept' | 'reject',
	reason?: string
) =>
	POST<ProposalDecisionResult>(`${ADMIN}/sync/change_proposals/decide`, {
		ids,
		decision,
		...(reason ? { reason } : {}),
	});

export const startReconciliationDelete = (sourceSystem: string) =>
	POST<{ job_id: string }>(`${ADMIN}/sync/replicate_reconciliation/delete`, {
		source_system: sourceSystem,
	});

// Roles
export type KeycloakRole = components['schemas']['KeycloakRole'];

export const listRoles = () => GET<KeycloakRole[]>(`${ADMIN}/roles`);
export const assignUserRoles = (userId: string, roles: string[]) =>
	POST(`${ADMIN}/users/${userId}/roles`, { roles });

// Project visibility grants: which projects a non-admin user may see and act in. Keyed by the
// user's Keycloak id (== `sub`). PUT replaces the whole set.
export type GrantedProject = components['schemas']['GrantedProject'];
export const getUserGrants = (userId: string) =>
	GET<GrantedProject[]>(`${ADMIN}/users/${userId}/grants`);

// The caller's visible sites as a project → subproject → site tree, grant-scoped server-side.
// Drives the sidebar site navigator. Keycloak-only, like `/api/me`.
export type NavigatorSite = components['schemas']['NavigatorSite'];
export type NavigatorSubproject = components['schemas']['NavigatorSubproject'];
export type NavigatorProject = components['schemas']['NavigatorProject'];
export const getMySites = () => GET<NavigatorProject[]>(`${ADMIN}/me/sites`);
export const setUserGrants = (userId: string, projectIds: string[]) =>
	PUT(`${ADMIN}/users/${userId}/grants`, { project_ids: projectIds });

// Realm directory search (LDAP-federated in production, covers all EPFL accounts).
// Each result includes the user's current realm roles.
export type DirectoryUser = components['schemas']['KeycloakUser'];

export const searchDirectoryUsers = (q: string) =>
	GET<DirectoryUser[]>(`${ADMIN}/users/search`, { q });

// Analytical tools. `GET /tools` serves the manifest of every active DB-stored R script;
// `POST /tools/{name}/calculate` runs one. Kinds: number | integer | string | boolean |
// enum:<v1|v2|...> | array | object | replicate_grid.
/**
 * The object form of a param's `when`: a condition on another param's value, carrying either
 * `equals` or `any_of`. This is the form the server enforces requiredness through.
 */
export type ToolParamCondition = components['schemas']['ParamCondition'];

/** A plain string is an advisory note and gates nothing; the object form is a condition. */
export type ToolParamWhen = components['schemas']['ParamWhen'];

export function isToolParamCondition(when: ToolParamWhen | null): when is ToolParamCondition {
	return typeof when === 'object' && when !== null;
}

/** One column of a structured param, as the manifest declares it. */
export type ToolStructField = components['schemas']['ManifestField'];

/**
 * What a structured param's value holds. `object` is one object of fields, `rows` an array of
 * them, `lists` an object of number lists keyed by field name.
 */
export type ToolStructure = components['schemas']['ManifestStructure'];

export type ToolParam = components['schemas']['ManifestParam'];

/** Which half of an output's declaration the server found the catalog row by. */
export type ToolParameterResolvedBy = 'id' | 'code';

export type ResolvedParameter = components['schemas']['ResolvedParameter'];

/** One output as a manifest declares it, which is what an author edits. */
export type ManifestOutput = components['schemas']['ManifestOutput'];

/** The same output as `GET /tools` serves it: the declaration plus the parameter it resolves to. */
export type ToolOutput = components['schemas']['ToolOutput'];

export type ToolCurveSlot = components['schemas']['ManifestCurve'];

/**
 * A version's manifest: the tool's whole interface. Every list is optional on the wire (the
 * server defaults each to empty), so a manifest under construction is a valid one.
 */
export type ToolManifest = components['schemas']['Manifest'];

/** A titled group of fields on the entry form. */
export type ToolSection = components['schemas']['ManifestSection'];

/**
 * One stored test case. `curves` are merged into the request body alongside `inputs`, `expected`
 * is compared key by key within the tolerance, and `absent` names keys the result must not carry.
 * `constants` makes a case reproducible whatever the constants table holds; without it the case
 * reads the catalog.
 *
 * Hand-written on purpose: a stored case set is free JSON on the version row, which the document
 * describes as an object.
 */
export interface ToolTestCase {
	name?: string;
	inputs?: Record<string, unknown>;
	curves?: Record<string, unknown>;
	expected?: Record<string, unknown>;
	absent?: string[];
	constants?: Record<string, number>;
}

// The case set as the version row stores it, hand-written with the case above.
export interface ToolTestCases {
	/** Relative, applied as tol * max(|expected|, 1). Defaults to 1e-9. */
	tolerance?: number;
	cases?: ToolTestCase[];
}

export type ToolDescriptor = components['schemas']['ToolDescriptor'];

export type ToolSiteInput = components['schemas']['ManifestSiteInput'];

export type ToolEventInput = components['schemas']['ManifestEventInput'];

export type ToolVersionRef = components['schemas']['ToolVersionRef'];

/** A curve as the runner received it. `standard_curve_id` is set when it came from the catalog. */
export type ToolResolvedCurve = components['schemas']['ResolvedCurve'];

/** One entry of the `curves` snapshot: the manifest slot name and the curve resolved into it. */
export type ToolCurveSnapshot = components['schemas']['CurveSnapshot'];

export type ToolCalculateResponse = components['schemas']['ToolResult'];

export const listTools = () => GET<ToolDescriptor[]>(`${SERVICE}/tools`);

export const calculateTool = (name: string, body: Record<string, unknown>) =>
	POST<ToolCalculateResponse>(`${SERVICE}/tools/${encodeURIComponent(name)}/calculate`, body);

// Tool script authoring (admin-only). Versions are immutable; activation flips the pointer and
// activating an older version is the rollback.
export type ToolScriptSummary = components['schemas']['ToolScriptList'];

export type ToolVersionSummary = components['schemas']['ToolScriptVersionList'];

export interface ToolScriptDetail extends ToolScriptSummary {
	versions: ToolVersionSummary[];
}

export type ToolVersionDetail = components['schemas']['ToolScriptVersion'];

export type ToolLintFinding = components['schemas']['LintFinding'];

export type ToolCaseResult = components['schemas']['CaseResult'];

export type ToolValidateResponse = components['schemas']['ValidateResponse'];

export type ToolActivationRecord = components['schemas']['ActivationRecord'];

export const listToolScripts = () => GET<ToolScriptSummary[]>(`${ADMIN}/tool_scripts`);

export const getToolScript = (id: string) => GET<ToolScriptDetail>(`${ADMIN}/tool_scripts/${id}`);

export const createToolScript = (body: {
	name: string;
	label: string;
	description?: string;
	created_by?: string;
}) => POST<ToolScriptSummary>(`${ADMIN}/tool_scripts`, body);

export const updateToolScript = (
	id: string,
	body: { label?: string; description?: string; enabled?: boolean },
) =>
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
export type ToolParseError = components['schemas']['ParseError'];

/** A detection the parse tree cannot complete. `expressions` is empty when `any` is false. */
export type ToolDynamicFlag = components['schemas']['DynamicFlag'];

/**
 * Every list is a floor rather than a complete set: keys assembled at run time (a replicate
 * letter pasted onto a base name) do not exist in the source. While `dynamic_outputs.any` is
 * true, `outputs` is short by an unknown amount and a manifest declaring more is not thereby
 * wrong; `dynamic_reads.any` says the same about `inputs`, `constants` and `curves`.
 */
export type ToolScriptInspection = components['schemas']['ScriptInspection'];

/**
 * What the script reads set against what the manifest declares. A comparison only: it proposes no
 * manifest. Each list may be empty. When `reads_complete` is false every `unread_*` entry is
 * possible rather than certain, and when `outputs_complete` is false the same holds for outputs.
 */
export type ToolManifestReconciliation = components['schemas']['ManifestReconciliation'];

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

export type ToolDraftRunRequest = components['schemas']['DraftRunRequest'];

/** Where a draft run ended, and therefore where the editor renders it. */
export type ToolDraftFailureKind = 'body_refused' | 'script_error' | 'runner_unavailable';

export type ToolDraftFailure = components['schemas']['DraftRunFailure'];

/**
 * A draft run answers 200 whether or not the script ran: a refused body, a raised script and an
 * absent runner are findings about the draft, so they arrive next to the lint findings rather than
 * discarding them.
 */
export type ToolDraftRunResponse = components['schemas']['DraftRunResponse'];

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
export type GrabSampleReading = components['schemas']['GrabSampleReading'];

export type GrabSampleRequest = components['schemas']['GrabSampleRequest'];

export type GrabPreviewCurve = components['schemas']['CurveApplication'];

export type GrabPreviewRow = components['schemas']['GrabPreview'];

export type GrabExistingReplicate = components['schemas']['ExistingReplicate'];

export type GrabExistingGroup = components['schemas']['ExistingGroup'];

export type ImpactParameter = components['schemas']['ImpactParameter'];

/** One calculation a save feeds, and the output parameters it rewrites at the visit. */
export type CalculationImpact = components['schemas']['CalculationImpact'];

export type GrabSampleResponse = components['schemas']['GrabSampleResponse'];

export const saveGrabSample = (req: GrabSampleRequest) =>
	POST<GrabSampleResponse>(`${SERVICE}/grab_samples`, req);

// --- Seasonal check (the portal's Check gate) --------------------------------------------------

export type SeasonalCheckValue = components['schemas']['SeasonalCheckValue'];

export type SeasonalClass =
	| 'no_history'
	| 'below_min'
	| 'below_q10'
	| 'normal'
	| 'above_q90'
	| 'above_max';

export type SeasonalFinding = components['schemas']['SeasonalFinding'];

export type SeasonalClassDescription = components['schemas']['SeasonalClassDescription'];

export type SeasonalMethod = components['schemas']['SeasonalMethod'];

export type SeasonalCheckResponse = components['schemas']['SeasonalCheckResponse'];

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

export type TunableSpec = components['schemas']['TunableSpec'];
export type Schedule = components['schemas']['ScheduleResponse'];

export type ScheduleAuditEntry = components['schemas']['ChangeEntry'];

export type ScheduleUpdate = components['schemas']['ScheduleUpdate'];

export type RunNowResponse = components['schemas']['RunNowResponse'];

// The schedules entity mounts read and update only: a row per registered job is inserted at boot,
// so a create or a delete has no meaning. A deployment carries one row per job, so the whole list
// is one page.
export const listSchedules = () =>
	getList<Schedule>(`${ADMIN}/schedules`, { perPage: 200, sort: ['job_name', 'ASC'] }).then(
		(r) => r.data,
	);

export const getSchedule = (jobName: string) =>
	GET<Schedule>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}`);

export const updateSchedule = (jobName: string, body: ScheduleUpdate) =>
	PUT<Schedule>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}`, body);

export const runScheduleNow = (jobName: string) =>
	POST<RunNowResponse>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}/run_now`);

export const getScheduleAudit = (jobName: string) =>
	GET<ScheduleAuditEntry[]>(`${ADMIN}/schedules/${encodeURIComponent(jobName)}/audit`);

export type ParameterStatistics = components['schemas']['ParameterStatistics'];

export type SiteStatisticsResponse = components['schemas']['StatisticsResponse'];

export const getSiteStatistics = (
	siteId: string,
	params: {
		start?: string;
		end?: string;
		parameter_ids?: string;
		measurement_type?: 'continuous' | 'spot';
	}
) => GET<SiteStatisticsResponse>(`${ADMIN}/sites/${siteId}/statistics`, params);

/** One calculation a set of parameters feeds, and the outputs it rewrites. */

export type SlotCoverage = components['schemas']['SlotCoverage'];

export type ClosureResponse = components['schemas']['ClosureResponse'];

export const getCalculationClosure = (params: {
	parameter_ids?: string;
	site_id?: string;
	include_coverage?: boolean;
}) => GET<ClosureResponse>(`${ADMIN}/calculations/closure`, params);

// The edit primitive (Q8, M60): the one path a stored measurement is changed by. Every edit is
// routed by what produced the value, previewed before it is written, and reversible after.

export type EditOptionKind =
	| 'reopen_run'
	| 'detach'
	| 'return'
	| 'value_correction'
	| 'curve'
	| 'edit_deployment'
	| 'edit_calibration'
	| 'flag'
	| 'unflag'
	| 'withdraw'
	| 'reassert'
	| 'verify'
	| 'reject';

export type EditRowProvenance = components['schemas']['RowProvenance'];

export type InspectedRow = components['schemas']['InspectedRow'];

/** A stream, a slot and window, or explicit keys. Naming nothing is refused. */
export type EditSelection = components['schemas']['Selection'];

export type EditDecisionBody = components['schemas']['EditDecision'];

export type MovedRow = components['schemas']['MovedRow'];

export type MovedSample = components['schemas']['MovedSample'];

export type EditPreviewResponse = components['schemas']['PreviewResponse'];

export type EditCommitResponse = components['schemas']['EditResponse'];

export const inspectEdits = (selection: EditSelection) =>
	POST<{ rows: InspectedRow[] }>(`${SERVICE}/readings/edits/inspect`, { selection });

export const previewEdit = (selection: EditSelection, decision: EditDecisionBody) =>
	POST<EditPreviewResponse>(`${SERVICE}/readings/edits/preview`, { selection, decision });

export const commitEdit = (
	selection: EditSelection,
	decision: EditDecisionBody,
	preview_id: string,
) => POST<EditCommitResponse>(`${SERVICE}/readings/edits`, { selection, decision, preview_id });

export const rollbackEdit = (decisionId: string) =>
	POST<{ rollback_id: string }>(`${SERVICE}/readings/edits/${decisionId}/rollback`, {});

export const rollbackEditSet = (setId: string) =>
	POST<{ set_id: string; rolled_back: number }>(
		`${SERVICE}/readings/edits/sets/${setId}/rollback`,
		{},
	);

export type ToolRunReload = components['schemas']['ReloadResponse'];

export const reloadToolRun = (runId: string) =>
	GET<ToolRunReload>(`${SERVICE}/tool_runs/${runId}/reload`);

export type ReadingDecision = components['schemas']['DecisionRow'];

export const getReadingDecisions = (key: {
	stream_id: string;
	time: string;
	replicate_index?: number;
}) => GET<ReadingDecision[]>(`${SERVICE}/readings/decisions`, { ...key });

export type LedgerEntry = components['schemas']['LedgerEntry'];

export type LedgerResponse = components['schemas']['LedgerResponse'];

/** Everything that happened to one measured instant, newest first, filtered by severity. */
export const getReadingLedger = (key: {
	time: string;
	stream_id?: string;
	site_id?: string;
	parameter_id?: string;
	measurement_type?: string;
	severity?: string;
	limit?: number;
}) => GET<LedgerResponse>(`${SERVICE}/readings/ledger`, { ...key });

export type ChangeEntry = components['schemas']['ChangeEntry'];

/** The change trail of one subject, newest first. An unknown subject is an empty list. */
export const getChangeAudit = (subject: string) =>
	GET<ChangeEntry[]>(`${SERVICE}/change_audit`, { subject });
