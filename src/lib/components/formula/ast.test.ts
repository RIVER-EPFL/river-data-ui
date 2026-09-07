import { describe, expect, it } from 'vitest';
import { payloadToNode, serializeToMeval, parseFromMeval } from './ast';

describe('payloadToNode', () => {
	it('serialises a dropped constant to its bare name, which is what the API resolves', () => {
		const node = payloadToNode({ kind: 'constant', name: 'gas_const_r_atm' });
		expect(serializeToMeval(node)).toBe('gas_const_r_atm');
	});

	it('treats a dropped parameter the same way', () => {
		const node = payloadToNode({ kind: 'variable', name: 'DOC_ppb' });
		expect(serializeToMeval(node)).toBe('DOC_ppb');
	});

	it('gives min and max two slots and every other function one', () => {
		expect(serializeToMeval(payloadToNode({ kind: 'function', name: 'min' }))).toBe('min(?, ?)');
		expect(serializeToMeval(payloadToNode({ kind: 'function', name: 'sqrt' }))).toBe('sqrt(?)');
	});

	it('takes what is already there as a function argument rather than discarding it', () => {
		const existing = parseFromMeval('DOC_ppb * 2');
		expect(serializeToMeval(payloadToNode({ kind: 'function', name: 'sqrt' }, existing)))
			.toBe('sqrt(DOC_ppb * 2)');
	});

	it('wraps what is already there in a dropped operator', () => {
		const existing = parseFromMeval('DOC_ppb');
		expect(serializeToMeval(payloadToNode({ kind: 'operator', op: '/' }, existing)))
			.toBe('DOC_ppb / ?');
	});
});

/// A constant and a parameter reach the formula as identifiers, so a round trip through the text
/// the API stores has to bring both back unchanged.
describe('a constant survives the text round trip', () => {
	it('parses back to the same formula', () => {
		const text = 'ch4_in_sa * vol_sa / gas_const_r_atm';
		expect(serializeToMeval(parseFromMeval(text))).toBe(text);
	});
});
