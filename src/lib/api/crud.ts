import { GET, POST, PUT, DELETE, getList, type Paginated } from './client';

export interface CrudClient<T> {
	list: (opts?: {
		page?: number;
		perPage?: number;
		sort?: [string, 'ASC' | 'DESC'];
		filter?: Record<string, unknown>;
	}) => Promise<Paginated<T>>;
	get: (id: string) => Promise<T>;
	create: (data: Partial<T>) => Promise<T>;
	update: (id: string, data: Partial<T>) => Promise<T>;
	remove: (id: string) => Promise<void>;
}

export function crudClient<T>(entity: string, base = '/api'): CrudClient<T> {
	const path = `${base}/${entity}`;
	return {
		list: (opts) => getList<T>(path, opts),
		get: (id) => GET<T>(`${path}/${id}`),
		create: (data) => POST<T>(path, data),
		update: (id, data) => PUT<T>(`${path}/${id}`, data),
		remove: (id) => DELETE<void>(`${path}/${id}`),
	};
}

export const api = {
	projects: crudClient<Project>('projects'),
	subprojects: crudClient<Subproject>('subprojects'),
	sites: crudClient<Site>('sites'),
	parameters: crudClient<Parameter>('parameters'),
	siteParameters: crudClient<SiteParameter>('site_parameters'),
	sensors: crudClient<Sensor>('sensors'),
	sensorCalibrations: crudClient<SensorCalibration>('sensor_calibrations'),
	standardCurves: crudClient<StandardCurve>('standard_curves'),
	sensorDeployments: crudClient<SensorDeployment>('sensor_deployments'),
	derivedParameters: crudClient<DerivedParameter>('derived_parameters'),
	derivedParameterSources: crudClient<DerivedParameterSource>('derived_parameter_sources'),
	samples: crudClient<Sample>('samples'),
	constants: crudClient<Constant>('constants'),
	alarmThresholds: crudClient<AlarmThreshold>('alarm_thresholds'),
	dataStreams: crudClient<DataStream>('data_streams'),
	annotations: crudClient<Annotation>('annotations'),
	notes: crudClient<Note>('notes'),
	apiTokens: crudClient<ApiToken>('tokens'),
	apiTokenAuditLogs: crudClient<ApiTokenAuditLog>('api_token_audit_logs'),
	reprocessingJobs: crudClient<ReprocessingJob>('reprocessing_jobs'),
	notificationLogs: crudClient<NotificationLog>('notification_logs'),
	notificationMutes: crudClient<NotificationMute>('notification_mutes'),
	// Keycloak realm accounts, not a database entity: the API proxies the realm behind the same
	// list shape. Admin-only, so only mount it from a route guarded by `me.can('admin')`.
	users: crudClient<RealmUser>('users'),
};

// Entity types
export interface RealmUser {
	id: string;
	username: string;
	email: string;
	firstName: string;
	lastName: string;
	enabled: boolean;
	roles?: string[];
}

export interface Project {
	id: string;
	name: string;
	description: string | null;
	data_source: string | null;
	is_public: boolean;
	public_code: string | null;
	public_api_title: string | null;
	public_api_description: string | null;
	public_api_version: string | null;
	public_contact_email: string | null;
	created_at: string;
	discovered_at: string | null;
}

export interface Subproject {
	id: string;
	project_id: string;
	name: string;
	description: string | null;
	created_at: string;
}

export interface Site {
	id: string;
	project_id: string;
	subproject_id: string | null;
	name: string;
	description: string | null;
	latitude: number | null;
	longitude: number | null;
	altitude_m: number | null;
	public_code: string | null;
	created_at: string;
}

export interface Parameter {
	id: string;
	code: string;
	name: string;
	description: string | null;
	default_units: string;
	category: string;
	aliases: string[] | null;
	default_warning_min: number | null;
	default_warning_max: number | null;
	default_alarm_min: number | null;
	default_alarm_max: number | null;
	created_at: string;
	updated_at: string;
}

export interface SiteParameter {
	id: string;
	site_id: string;
	parameter_id: string;
	name: string | null;
	sensor_type: string | null;
	display_units: string | null;
	channel_id: number | null;
	sample_interval_sec: number | null;
	decimal_places: number | null;
	is_derived: boolean | null;
	derived_definition_id: string | null;
	is_active: boolean | null;
	is_public: boolean;
	created_at: string;
}

export interface Sensor {
	id: string;
	serial_number: string | null;
	name: string | null;
	manufacturer: string | null;
	model: string | null;
	is_active: boolean | null;
	is_lab_instrument: boolean | null;
	/** 'high' (field stream -> continuous readings) or 'low' (lab/campaign -> spot readings). */
	data_frequency: string;
	notes: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string | null;
	// read-only enrichment (populated by the API, never sent on create/update)
	deployments?: SensorDeployment[];
	reading_count?: number | null;
	last_reading_at?: string | null;
	last_calibration_at?: string | null;
	current_site_id?: string | null;
	current_site_name?: string | null;
	last_reading_value?: number | null;
}

export interface SensorCalibration {
	id: string;
	sensor_id: string;
	name: string | null;
	parameter_id: string | null;
	slope: number;
	intercept: number;
	r_squared: number | null;
	valid_from: string;
	valid_until: string | null;
	performed_by: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * A curve belonging to one instrument, chosen by hand per measurement rather than resolved by time.
 * It has no time columns, so it never takes part in calibration chaining.
 *
 * Only `sensor_id` and `name` are filterable; only `name` and `created_at` are sortable.
 * `created_by` is caller-supplied on create, not server-stamped.
 *
 * A curve becomes immutable once a reading references it: the API refuses any change to
 * slope/intercept/r_squared/name/sensor_id/created_by (notes stay editable) and refuses delete.
 * Mint a new curve instead. `slope` of 0 is refused on create and update.
 */
export interface StandardCurve {
	id: string;
	sensor_id: string;
	name: string | null;
	slope: number;
	intercept: number;
	r_squared: number | null;
	notes: string | null;
	created_at: string;
	created_by: string | null;
}

export interface SensorDeployment {
	id: string;
	sensor_id: string;
	site_id: string;
	/** Denormalized from the sensor's parameter (DB trigger set_deployment_parameter_id). Read-only. */
	parameter_id: string;
	deployed_from: string;
	deployed_until: string | null;
	deployment_type: string;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface DerivedParameter {
	id: string;
	code: string;
	name: string;
	units: string;
	formula: string;
	output_parameter_id: string | null;
	description: string | null;
	sources: DerivedParameterSource[];
	created_at: string;
	updated_at: string;
}

export interface DerivedParameterSource {
	id: string;
	derived_definition_id: string;
	parameter_id: string;
	variable_name: string;
	created_at: string;
}

export interface Sample {
	id: string;
	site_id: string;
	parameter_id: string;
	collected_at: string;
	label: string | null;
	notes: string | null;
	created_by: string | null;
	created_at: string | null;
	mean: number | null;
	stdev: number | null;
	n: number;
	min_value: number | null;
	max_value: number | null;
	updated_at: string | null;
}

export interface Constant {
	id: string;
	name: string;
	value: number;
	units: string | null;
	description: string | null;
	created_at: string;
	updated_at: string;
}

export interface AlarmThreshold {
	id: string;
	site_id: string | null;
	parameter_id: string | null;
	warning_min: number | null;
	warning_max: number | null;
	alarm_min: number | null;
	alarm_max: number | null;
	created_at: string;
	updated_at: string;
}

export interface DataStream {
	id: string;
	source_system: string;
	source_key: string;
	source_name: string | null;
	source_path: string | null;
	metadata: Record<string, unknown>;
	site_parameter_id: string | null;
	/** Stream-level default for readings.measurement_type ('continuous' | 'spot' | 'derived'); null defers to the sensor. */
	measurement_type: string | null;
	is_active: boolean;
	last_data_time: string | null;
	created_at: string;
	updated_at: string;
}

export interface Annotation {
	id: string;
	site_id: string;
	parameter_id: string;
	start_time: string;
	end_time: string;
	text: string;
	category: string;
	created_by: string | null;
	created_at: string | null;
}

export interface Note {
	id: string;
	site_id: string;
	text: string;
	author: string | null;
	created_at: string;
	updated_at: string;
}

export type TokenPermissions = {
	read_metadata: boolean;
	read_data: boolean;
	write_metadata: boolean;
	write_data: boolean;
};

export interface ApiToken {
	id: string;
	name: string;
	description?: string | null;
	/** One-time secret, present only in the create/rotate response. Never stored. */
	token?: string;
	/** Non-secret lookup prefix (the `rvd_<prefix>_…` part). */
	token_prefix?: string;
	permissions: TokenPermissions;
	project_scope?: string | null;
	rate_limit_per_second?: number | null;
	is_active?: boolean;
	expires_at: string | null;
	last_used_at?: string | null;
	created_at: string;
	created_by?: string | null;
}

/** One recorded API-token request from the forensic audit log (read-only, admin-only). */
export interface ApiTokenAuditLog {
	id: string;
	token_id: string;
	method: string;
	path: string;
	status_code: number;
	project_scope: string | null;
	created_at: string;
}

export interface ReprocessingJob {
	id: string;
	sensor_id: string | null;
	trigger_type: string;
	trigger_id: string | null;
	status: string;
	readings_updated: number | null;
	progress: number | null;
	total: number | null;
	error_message: string | null;
	retry_count: number;
	category: string;
	site_id: string | null;
	parent_job_id: string | null;
	detail: Record<string, unknown>;
	created_at: string;
	completed_at: string | null;
}

export interface JobLogLine {
	seq: number;
	ts: string;
	level: string;
	message: string;
	context: Record<string, unknown>;
}

/** One recorded notification delivery attempt (read-only history). */
export interface NotificationLog {
	id: string;
	alarm_event_id: string | null;
	kind: string;
	channel: string;
	recipient: string;
	status: string;
	error: string | null;
	created_at: string;
}

/** A (site, parameter) slot muted from notifications, optionally with an expiry. */
export interface NotificationMute {
	id: string;
	site_id: string;
	parameter_id: string;
	expires_at: string | null;
	created_by: string | null;
	created_at: string;
}
