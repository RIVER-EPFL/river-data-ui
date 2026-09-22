import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import InfoTip from './InfoTip.svelte';

describe('InfoTip', () => {
	const text = 'One row per visit, one column per parameter code.';

	it('carries its explanation as both the tooltip and the label', () => {
		render(InfoTip, { text });
		const tip = screen.getByRole('button', { name: text });
		expect(tip.getAttribute('title')).toBe(text);
	});

	// A tip nobody can reach by keyboard is a tip half the readers do not have.
	it('is reachable without a pointer', () => {
		render(InfoTip, { text });
		const tip = screen.getByRole('button', { name: text });
		tip.focus();
		expect(document.activeElement).toBe(tip);
	});
});
