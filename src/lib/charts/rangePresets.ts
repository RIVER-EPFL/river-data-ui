/** The fixed windows a time range can be set to in one click, shortest first. */
export const RANGE_PRESETS = ['24h', '7d', '30d', '90d'] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

const DAY_MS = 86_400_000;

export const RANGE_MS: Record<RangePreset, number> = {
	'24h': DAY_MS,
	'7d': 7 * DAY_MS,
	'30d': 30 * DAY_MS,
	'90d': 90 * DAY_MS,
};

/** The window a preset names, ending at `end` and starting no earlier than `min` when given. */
export function presetWindow(
	preset: RangePreset,
	end: number,
	min?: number,
): { start: number; end: number } {
	const start = end - RANGE_MS[preset];
	return { start: min === undefined ? start : Math.max(min, start), end };
}

/** The preset a window's length matches to within a minute, or null. */
export function activePreset(start: number, end: number): RangePreset | null {
	const length = end - start;
	return RANGE_PRESETS.find((preset) => Math.abs(length - RANGE_MS[preset]) < 60_000) ?? null;
}
