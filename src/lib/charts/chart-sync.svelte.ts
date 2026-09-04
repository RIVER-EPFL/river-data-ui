import type uPlot from 'uplot';
import type { AlarmThreshold, Annotation } from '$api/crud';
import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';
import type { SpotPointStats } from './spotMarkers';
import type { SdEstimator } from '$lib/sdEstimator';

export interface ChartRegistration {
	id: string;
	parameterName: string;
	units: string;
	/** `site_parameters.decimal_places` for the slot, null when the slot declares none. */
	decimals?: number | null;
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
	/** Flagged state of the spot arm keyed by epoch ms. On a chart carrying both cadences the
	 *  published `flags` are the continuous arm's, so a flagged grab is only visible here. */
	spotFlags?: Map<number, boolean> | null;
	// One-line ingestion origin for the series, e.g. "via cnet portal sync".
	originLabel?: string;
	/** The divisor the slot declares, which is what any printed sd was computed under. */
	sdEstimator?: SdEstimator | null;
}

export interface CursorState {
	idx: number;
	mouseX: number;
	mouseY: number;
	/**
	 * Registration id of the chart the cursor is actually over. The shared tooltip shows every
	 * registered series at the instant, but the provenance of one measurement belongs to the chart
	 * being read; the others are there for comparison.
	 */
	sourceId?: string;
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

/**
 * Publish a plot's cursor to its sync group, which is what feeds the shared tooltip. The hide is
 * deferred by a frame so moving between two plots in one group does not blink the tooltip out.
 */
export function cursorSyncPlugin(group: ChartSyncGroup, chartId: string): uPlot.Plugin {
	let hideRaf: number | null = null;
	return {
		hooks: {
			setCursor: [
				(u: uPlot) => {
					const idx = u.cursor.idx;
					if (idx != null && idx >= 0 && idx < (u.data[0]?.length ?? 0)) {
						if (hideRaf != null) {
							cancelAnimationFrame(hideRaf);
							hideRaf = null;
						}
						const bbox = u.root.getBoundingClientRect();
						group.setCursor({
							idx,
							mouseX: (u.cursor.left ?? 0) + bbox.left,
							mouseY: (u.cursor.top ?? 0) + bbox.top,
							sourceId: chartId,
						});
					} else {
						hideRaf = requestAnimationFrame(() => {
							group.setCursor(null);
							hideRaf = null;
						});
					}
				},
			],
		},
	};
}
