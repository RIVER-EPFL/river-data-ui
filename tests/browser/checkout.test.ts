import { describe, expect, it } from 'vitest';
import { foreignServerRefusal } from './checkout';

const URL = 'http://localhost:5174';
const ROOT = '/home/dev/river-data-ui';

describe('foreignServerRefusal', () => {
	it('lets this checkout through', () => {
		expect(foreignServerRefusal(URL, ROOT, { root: ROOT })).toBeNull();
	});

	it('names both checkouts when another one holds the port', () => {
		const refusal = foreignServerRefusal(URL, ROOT, { root: '/home/dev/worktrees/ui-b14-99' });
		expect(refusal).toContain('/home/dev/worktrees/ui-b14-99');
		expect(refusal).toContain(ROOT);
		expect(refusal).toContain('E2E_PORT');
	});

	it('refuses a server that identifies no checkout at all', () => {
		expect(foreignServerRefusal(URL, ROOT, null)).toContain('does not say which checkout');
	});
});
