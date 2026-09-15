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
	parameterGroups: crudClient<ParameterGroup>('parameter_groups'),
	parameterGroupMembers: crudClient<ParameterGroupMember>('parameter_group_members'),
	siteParameters: crudClient<SiteParameter>('site_parameters'),
	sensors: crudClient<Sensor>('sensors'),
	sensorCalibrations: crudClient<SensorCalibration>('sensor_calibrations'),
	standardCurves: crudClient<StandardCurve>('standard_curves'),
	sensorDeployments: crudClient<SensorDeployment>('sensor_deployments'),
	derivedParameters: crudClient<DerivedParameter>('derived_parameters'),
	derivedParameterSources: crudClient<DerivedParameterSource>('derived_parameter_sources'),
	samples: crudClient<Sample>('samples'),
	collectionEvents: crudClient<CollectionEvent>('collection_events'),
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
	notificationSubscribers: crudClient<NotificationSubscriber>('notification_subscribers'),
	calculationSharedSteps: crudClient<CalculationSharedStep>('calculation_shared_steps'),
	meteoswissSubscriptions: crudClient<MeteoswissSubscription>('meteoswiss_subscriptions'),
	// Keycloak realm accounts, not a database entity: the API proxies the realm behind the same
	// list shape. Admin-only, so only mount it from a route guarded by `me.can('admin')`.
	users: crudClient<RealmUser>('users'),
};

// Entity types

/** A site's subscription to one MeteoSwiss station and one of the variables it publishes. */
export interface MeteoswissSubscription {
	id: string;
	site_id: string;
	station_abbr: string;
	variable: string;
	parameter_id: string;
	enabled: boolean;
	created_at?: string | null;
}

export interface RealmUser {
	id: string;
	username: string;
	email: string;
	firstName: string;
	lastName: string;
	enabled: boolean;
	roles?: string[];
}

/** A field visit: one (site, collection instant) every spot reading of that visit attaches to. */
export interface CollectionEvent {
	id: string;
	site_id: string;
	collected_at: string;
	source: string;
	created_by: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string | null;
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
	/** Stamped when a sync minted the site; null means it was entered by hand. */
	discovered_at: string | null;
}

/**
 * The columns of a site's own row, which is what a formula's site source may name (D13): any
 * column resolves, and the kind check at calculate time is what refuses a text one in a number
 * input. The type check below is what keeps this list level with `Site`.
 */
export const SITE_PROPERTIES = [
	'id',
	'project_id',
	'subproject_id',
	'name',
	'description',
	'latitude',
	'longitude',
	'altitude_m',
	'public_code',
	'created_at',
	'discovered_at',
] as const satisfies ReadonlyArray<keyof Site>;

type UnlistedSiteColumn = Exclude<keyof Site, (typeof SITE_PROPERTIES)[number]>;
// A column added to `Site` and not to `SITE_PROPERTIES` fails here rather than in a formula.
const _everySiteColumnIsListed: UnlistedSiteColumn extends never ? true : never = true;
void _everySiteColumnIsListed;

export interface Parameter {
	id: string;
	code: string;
	name: string;
	description: string | null;
	default_units: string;
	category: string;
	aliases: string[] | null;
	/** Catalog entry created mechanically (analyte seed); a manager confirms or merges it. */
	needs_review: boolean;
	/** The calculation that minted this row and no longer publishes it, where one did: a formula
	 *  ticked as a step still names this code. Read from the formulas, never stored. */
	unpublished_by?: string | null;
	created_at: string;
	updated_at: string;
}

/** A scientific category of parameters: the portal's categories, in their own order. */
export interface ParameterGroup {
	id: string;
	code: string;
	label: string;
	description: string | null;
	/** Where the group sits in the category order. */
	ordinal: number;
	created_at: string;
}

/** One parameter's membership of a group, carrying the group's presentation overrides. */
export interface ParameterGroupMember {
	id: string;
	group_id: string;
	parameter_id: string;
	ordinal: number;
	replicates: Record<string, unknown> | null;
	/** What the source computed this member with: `{ function, inputs }`, the portal's own
	 *  calculation and the columns it reads. Null where nothing computed the column. */
	source_calculation: { function?: string; inputs?: string[] } | null;
	label: string | null;
	units: string | null;
	decimal_places: number | null;
	description: string | null;
	created_at: string;
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
	/** How this site fills the slot: 'manual' (typed by hand) or 'tool' (computed here). */
	entry_mode: string;
	/** The instrument that measures this slot; null is undeclared, and never inferred at a write. */
	instrument_sensor_id: string | null;
	is_active: boolean | null;
	is_public: boolean;
	/** Slot minted by a verified tool save; a manager confirms it from the site's Parameters tab. */
	needs_review: boolean;
	/** 'sample' | 'population' | null (undeclared). Changed only through the declare endpoint. */
	sd_estimator: string | null;
	created_at: string;
	/** Stamped when a sync minted the slot; null means it was entered by hand. */
	discovered_at: string | null;
}

export interface Sensor {
	id: string;
	serial_number: string | null;
	name: string | null;
	manufacturer: string | null;
	model: string | null;
	/** The measurement range the manufacturer specifies for this unit. Null is unstated, not
	 *  unbounded, and takes no part in threshold resolution. */
	range_min: number | null;
	range_max: number | null;
	is_active: boolean | null;
	is_lab_instrument: boolean | null;
	/** What the row is: 'device', 'lab', 'source_parameter' or 'entry_channel'. */
	kind: string;
	/** 'high' (field stream -> continuous readings) or 'low' (lab/campaign -> spot readings). */
	data_frequency: string;
	notes: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string | null;
	/** The portal a replicated instrument came from, null for one registered here. A synced row
	 *  labels a portal's analyte, not a physical device, so the source is shown wherever an
	 *  operator picks an instrument. */
	source_system: string | null;
	source_key: string | null;
	// read-only enrichment (populated by the API, never sent on create/update)
	deployments?: SensorDeployment[];
	reading_count?: number | null;
	last_reading_at?: string | null;
	last_calibration_at?: string | null;
	current_site_id?: string | null;
	current_site_name?: string | null;
	last_reading_value?: number | null;
	/** Standard curves fitted on this instrument: what a lab row states where a device states a site. */
	curve_count?: number | null;
	/** The newest reading any of those curves corrected. */
	last_curve_use?: string | null;
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
	/** When the curve was taken out of circulation: it is never resolved for a reading again and
	 *  never bounds another curve's window. The row and the readings it corrected stay. */
	retired_at: string | null;
	retired_by: string | null;
	retired_reason: string | null;
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
	/** The date the curve was fitted, which is how the lab identifies one. */
	fitted_on: string | null;
	slope: number;
	intercept: number;
	r_squared: number | null;
	notes: string | null;
	created_at: string;
	created_by: string | null;
	/** The portal that replicated this curve, null for one entered here. A replicated curve is
	 *  re-asserted every sync cycle, so a coefficient edit to one no reading has used yet is
	 *  overwritten on the next pass. */
	source_system: string | null;
	source_key: string | null;
	/** The curve this one was copied from, stated by whoever made the copy. Frozen once stored. */
	copied_from_id: string | null;
	/** When the lab took the curve out of circulation. It is no longer offered for a new
	 *  measurement; the readings it corrected keep it and their values. */
	retired_at: string | null;
	retired_by: string | null;
	retired_reason: string | null;
}

export interface SensorDeployment {
	id: string;
	sensor_id: string;
	site_id: string;
	/** The parameter this deployment binds the sensor to at the site. Required on create, immutable afterwards. */
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
	/** The calculation this formula belongs to. Null is a standalone definition, the per-reading
	 *  continuous kind the derived job and janitor serve. */
	tool_script_id: string | null;
	/** Evaluation order inside the calculation. */
	ordinal: number;
	/** The curve slot this formula corrects with; its coefficients reach the formula as
	 *  `curve_slope` and `curve_intercept`. */
	curve_slot: string | null;
	/** The variable whose replicate vector this formula evaluates over, one reading per index under
	 *  its output parameter. Null is a formula producing one number. */
	per_replicate: string | null;
	/** A step of the calculation rather than a measurement: it mints no catalog parameter, saves
	 *  nowhere, and reaches the formulas after it under its own code. */
	intermediate: boolean;
	sources: DerivedParameterSource[];
	/** Why the code can no longer be changed, when it cannot: the catalog code is the CSV column
	 *  header and the public API's identifier, so a rename is refused once readings are stored
	 *  under the output parameter or a project publishes it. Null while it is still free. */
	code_locked: string | null;
	created_at: string;
}

export interface DerivedParameterSource {
	id: string;
	derived_definition_id: string;
	parameter_id: string;
	variable_name: string;
	created_at: string;
}

/** Statistics of two or more replicate readings sharing an instant. Label, notes, author and the
 * tool-run provenance blob are properties of the measurement and live on the reading. */
export interface Sample {
	id: string;
	site_id: string;
	parameter_id: string;
	collected_at: string;
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
	// The audit hold whose resolution minted this note; null for a hand-written one.
	audit_hold_id: string | null;
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
	params: Record<string, unknown>;
	created_at: string;
	completed_at: string | null;
	rerunnable: boolean;
	cancellable: boolean;
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

/**
 * Somebody notifications are addressed to, keyed by their Keycloak `sub`. `push_subscription_count`
 * is filled by the entity's own hook, not stored on the row.
 */
export interface NotificationSubscriber {
	id: string;
	keycloak_sub: string;
	web_push_enabled: boolean;
	push_subscription_count: number | null;
	created_at: string;
	updated_at: string;
}

/**
 * One calculation's declaration that it reads a step belonging to no calculation (Q156). The step
 * itself is a `DerivedParameter` row that is `intermediate` with no `tool_script_id`.
 */
export interface CalculationSharedStep {
	id: string;
	tool_script_id: string;
	formula_id: string;
	created_at: string;
}

/** A (site, parameter) slot muted from notifications, optionally with an expiry. *//** A (site, parameter) slot muted from notifications, optionally with an expiry. */
export interface NotificationMute {
	id: string;
	site_id: string;
	parameter_id: string;
	expires_at: string | null;
	created_by: string | null;
	created_at: string;
}
