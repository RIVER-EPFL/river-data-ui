import { configure } from '@testing-library/svelte';
import { vi } from 'vitest';

// How long a findBy or waitFor may wait for a mount to settle on a loaded machine.
configure({ asyncUtilTimeout: 15_000 });

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
