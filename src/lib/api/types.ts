export interface SampleReplicate {
	replicate_index: number;
	raw_value: number;
	calibrated_value?: number | null;
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
