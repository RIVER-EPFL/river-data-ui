import { vi } from 'vitest';

// jsdom implements neither, and the chart and dialog components construct both on mount.
vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
vi.stubGlobal(
	'matchMedia',
	(query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
);
