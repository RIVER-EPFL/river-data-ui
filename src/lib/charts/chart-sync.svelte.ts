import type { AlarmThreshold, Annotation } from '$api/crud';
import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';
import type { SpotPointStats } from './spotMarkers';

export interface ChartRegistration {
	id: string;
	parameterName: string;
	units: string;
	paletteIndex: number;
	times: number[];
	values: (number | null)[];
	threshold?: AlarmThreshold | null;
	flags?: (boolean | null)[] | null;
	flagReasons?: (string | null)[] | null;
	annotations?: Annotation[];
	sensorBands?: SensorIdentityBand[];
	calibrationMarkers?: CalibrationMarker[];
	// Sample stats keyed by time (ms) for spot points.
	spotStats?: Map<number, SpotPointStats> | null;
	// One-line ingestion origin for the series, e.g. "via cnet portal sync".
	originLabel?: string;
}

export interface CursorState {
	idx: number;
	mouseX: number;
	mouseY: number;
}

class ChartSyncGroup {
	registrations = $state<Map<string, ChartRegistration>>(new Map());
	cursor = $state<CursorState | null>(null);

	register(reg: ChartRegistration) {
		this.registrations.set(reg.id, reg);
	}

	update(id: string, patch: Partial<ChartRegistration>) {
		const existing = this.registrations.get(id);
		if (existing) this.registrations.set(id, { ...existing, ...patch });
	}

	unregister(id: string) {
		this.registrations.delete(id);
	}

	setCursor(state: CursorState | null) {
		this.cursor = state;
	}

	clear() {
		this.registrations.clear();
		this.cursor = null;
	}
}

const groups = new Map<string, ChartSyncGroup>();

export function getChartSyncGroup(key: string): ChartSyncGroup {
	let group = groups.get(key);
	if (!group) {
		group = new ChartSyncGroup();
		groups.set(key, group);
	}
	return group;
}
