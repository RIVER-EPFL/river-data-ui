export interface SampleReplicate {
	replicate_index: number;
	raw_value: number;
	calibrated_value?: number | null;
	/** Base (time-windowed) calibration this replicate was corrected with; null when none was. */
	calibration_id?: string | null;
	/** Standard curve applied on top of the base calibration; null when none was. */
	standard_curve_id?: string | null;
	flagged: boolean;
}

export interface SampleStat {
	sample_id: string;
	n: number;
	mean?: number | null;
	stdev?: number | null;
	min?: number | null;
	max?: number | null;
	replicates: SampleReplicate[];
}

export interface ReadingsParameter {
	// id is the site_parameter id; parameter_id is the global parameter id
	id: string;
	parameter_id?: string;
	name: string;
	display_name?: string;
	type?: string;
	units: string | null;
	values: (number | null)[];
	severities?: (number | null)[] | null;
	flagged?: (boolean | null)[] | null;
	flag_reasons?: (string | null)[] | null;
	// Per-point sample stats with replicates; present when include_sample_stats=true
	samples?: (SampleStat | null)[] | null;
	// Per-point curve references, present when include_curves=true. A null entry means no curve of
	// that kind was applied, which is why the two are reported separately rather than collapsed.
	calibration_ids?: (string | null)[] | null;
	standard_curve_ids?: (string | null)[] | null;
	// The streams paired into this slot; present when include_origin=true.
	origins?: { stream_id: string; source_system: string; source_key: string }[];
}

export interface ReadingsResponse {
	project?: { id: string; name: string } | null;
	site: { id: string; name: string };
	start?: string | null;
	end?: string | null;
	times: string[];
	parameters: ReadingsParameter[];
}

export interface AggregatesParameter {
	// id is the site_parameter id; parameter_id is the global parameter id
	id: string;
	parameter_id?: string;
	name: string;
	units: string | null;
	avg: (number | null)[];
	min: (number | null)[];
	max: (number | null)[];
	count: number[];
	max_severity?: (number | null)[] | null;
	flagged_count?: number[];
}

export interface AggregatesResponse {
	times: string[];
	parameters: AggregatesParameter[];
}

export interface StatusEvent {
	parameter_id: string;
	time: string;
	value: string;
	sensor_id?: string | null;
}

export interface StatusEventsResponse {
	site: { id: string; name: string };
	events: StatusEvent[];
	total: number;
}
