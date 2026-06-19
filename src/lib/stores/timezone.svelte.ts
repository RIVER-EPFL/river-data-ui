export type TimeZoneMode = 'local' | 'utc';

const STORAGE_KEY = 'river-data-tz';

// Read the saved preference lazily so a server-side prerender pass (adapter-static
// builds a fallback index.html) never touches localStorage.
function load(): TimeZoneMode {
	if (typeof localStorage === 'undefined') return 'local';
	return localStorage.getItem(STORAGE_KEY) === 'utc' ? 'utc' : 'local';
}

let mode = $state<TimeZoneMode>(load());

export const timezoneStore = {
	get mode(): TimeZoneMode {
		return mode;
	},
	/**
	 * IANA zone string for Intl/uPlot formatters: `'UTC'` in UTC mode, otherwise
	 * `undefined` so they resolve to the browser's local zone. Reading this inside a
	 * reactive context (template, `$derived`, `$effect`) tracks the preference, so a
	 * toggle re-renders every consumer.
	 */
	get zone(): string | undefined {
		return mode === 'utc' ? 'UTC' : undefined;
	},
	set(next: TimeZoneMode) {
		mode = next;
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
	},
	toggle() {
		this.set(mode === 'utc' ? 'local' : 'utc');
	},
};
