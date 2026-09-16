import { vi } from 'vitest';

// jsdom implements none of these, and the chart, dialog and sheet grid components construct them on
// mount.
class InertObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}
vi.stubGlobal('ResizeObserver', InertObserver);
vi.stubGlobal('IntersectionObserver', InertObserver);
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
