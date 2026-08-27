// Comparing what a tool returned against what a test case expects, and reading a failed R run.
//
// The server compares the same way when it validates a stored version, so the rule is restated
// here rather than approximated: a number matches within `tolerance * max(|expected|, 1)`, an
// object is compared key by key over the keys the expectation names, and an array must have the
// same length. Reproducing it is what lets a case be checked in the editor before it is saved.

import { draftRunToolScript, type ToolManifest, type ToolTestCase } from '$api/service';
import { apiMessage } from '$lib/standardCurves';

export const DEFAULT_TOLERANCE = 1e-9;

export interface ComparisonRow {
	/** The output key, or a dotted path into a nested one. */
	key: string;
	expected: string;
	got: string;
	/** `got - expected` when both are numbers; empty otherwise. */
	difference: string;
	passed: boolean;
}

/** The runner returns a one-element array where R produced a length-1 vector. */
function asNumber(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (Array.isArray(v) && v.length === 1) return asNumber(v[0]);
	return null;
}

export function formatValue(v: unknown): string {
	if (v === undefined) return 'missing';
	if (v === null) return 'null';
	if (typeof v === 'number') return String(v);
	if (Array.isArray(v) && v.length === 1) return formatValue(v[0]);
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}

function formatDifference(expected: number, got: number): string {
	const d = got - expected;
	if (d === 0) return '0';
	const abs = Math.abs(d);
	return abs >= 1e-4 && abs < 1e6 ? String(Number(d.toPrecision(6))) : d.toExponential(3);
}

function compareInto(rows: ComparisonRow[], path: string, expected: unknown, got: unknown, tol: number) {
	// Only the observed side is unwrapped: R returns a length-1 vector where a scalar was meant,
	// and the server unwraps that too, but an expectation written as a one-element array is an
	// expectation of an array and is compared as one.
	const expNum = typeof expected === 'number' && Number.isFinite(expected) ? expected : null;
	if (expNum !== null) {
		const gotNum = asNumber(got);
		const passed = gotNum !== null && Math.abs(gotNum - expNum) <= tol * Math.max(Math.abs(expNum), 1);
		rows.push({
			key: path,
			expected: formatValue(expected),
			got: formatValue(got),
			difference: gotNum !== null ? formatDifference(expNum, gotNum) : '',
			passed,
		});
		return;
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(got) || got.length !== expected.length) {
			rows.push({
				key: path,
				expected: `${formatValue(expected)} (${expected.length} values)`,
				got: Array.isArray(got) ? `${formatValue(got)} (${got.length} values)` : formatValue(got),
				difference: '',
				passed: false,
			});
			return;
		}
		expected.forEach((e, i) => compareInto(rows, `${path}[${i}]`, e, got[i], tol));
		return;
	}
	if (expected !== null && typeof expected === 'object') {
		const gotObj = got !== null && typeof got === 'object' ? (got as Record<string, unknown>) : null;
		if (!gotObj) {
			rows.push({ key: path, expected: formatValue(expected), got: formatValue(got), difference: '', passed: false });
			return;
		}
		for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
			compareInto(rows, `${path}.${k}`, v, gotObj[k], tol);
		}
		return;
	}
	rows.push({
		key: path,
		expected: formatValue(expected),
		got: formatValue(got),
		difference: '',
		passed: expected === got,
	});
}

export function compareResults(
	expected: Record<string, unknown> | undefined,
	got: Record<string, unknown>,
	absent: string[] | undefined,
	tolerance: number,
): ComparisonRow[] {
	const rows: ComparisonRow[] = [];
	for (const [key, exp] of Object.entries(expected ?? {})) {
		compareInto(rows, key, exp, got[key], tolerance);
	}
	for (const key of absent ?? []) {
		const value = got[key];
		const present = value !== undefined && value !== null;
		rows.push({
			key,
			expected: 'absent',
			got: present ? formatValue(value) : 'absent',
			difference: '',
			passed: !present,
		});
	}
	return rows;
}

export const allPassed = (rows: ComparisonRow[]) => rows.every((r) => r.passed);

// The three shapes `POST /tool_scripts/{id}/versions/{vid}/validate` reports a mismatch in.
const EXPECTED_GOT = /^(.+?): expected (.*), got (.*)$/;
const MISSING = /^(.+?): missing from result$/;
const ABSENT = /^(.+?): expected absent, got (.*)$/;

/**
 * The validate endpoint states a mismatch as one line per key. Reading it back into rows keeps
 * one presentation for a stored version's failures and a case run in the editor; a line in any
 * other shape is kept whole rather than guessed at.
 */
export function rowsFromFailures(failures: string[]): ComparisonRow[] {
	return failures.map((line) => {
		const absent = ABSENT.exec(line);
		if (absent) {
			return { key: absent[1], expected: 'absent', got: absent[2], difference: '', passed: false };
		}
		const missing = MISSING.exec(line);
		if (missing) {
			return { key: missing[1], expected: '', got: 'missing', difference: '', passed: false };
		}
		const both = EXPECTED_GOT.exec(line);
		if (both) {
			const e = Number(both[2]);
			const g = Number(both[3]);
			const numeric = Number.isFinite(e) && Number.isFinite(g);
			return {
				key: both[1],
				expected: both[2],
				got: both[3],
				difference: numeric ? formatDifference(e, g) : '',
				passed: false,
			};
		}
		return { key: '', expected: '', got: line, difference: '', passed: false };
	});
}

/** What one run of a test case produced. */
export interface CaseRun {
	rows: ComparisonRow[];
	failure: ToolRunFailure | null;
	/** Null when the script raised, so nothing can be adopted as an expectation. */
	results: Record<string, unknown> | null;
	passed: boolean;
}

/** A failure raised inside the R script, as the API reports it. */
export interface ToolRunFailure {
	message: string;
	call: string | null;
	traceback: string[];
}

/**
 * A failed run, read from the structured body the API sends for an error raised inside the
 * script. Anything else (a refused body, an unreachable runner) has only a message.
 */
export function toolRunFailure(e: unknown): ToolRunFailure {
	const raw = e instanceof Error ? e.message : String(e);
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			const rec = parsed as Record<string, unknown>;
			if (typeof rec.message === 'string') {
				return {
					message: rec.message,
					call: typeof rec.call === 'string' ? rec.call : null,
					traceback: Array.isArray(rec.traceback)
						? rec.traceback.filter((t): t is string => typeof t === 'string')
						: [],
				};
			}
		}
	} catch {
		// Plain-text body; apiMessage handles the rest.
	}
	return { message: apiMessage(e), call: null, traceback: [] };
}

/**
 * One stored case through the draft-run endpoint, compared the way the server compares it. Shared
 * by the case table and by the validation record, so a case reads the same in both.
 */
export async function runTestCase(opts: {
	script: string;
	entryFunction: string;
	manifest: ToolManifest;
	testCase: ToolTestCase;
	tolerance: number;
}): Promise<CaseRun> {
	const { script, entryFunction, manifest, testCase, tolerance } = opts;
	// A case's curves are fields of the same body as its inputs, which is how the server reads a
	// case and how `/tools/{name}/calculate` reads a request.
	const inputs = { ...(testCase.inputs ?? {}), ...(testCase.curves ?? {}) };
	try {
		const res = await draftRunToolScript({
			script,
			entry_function: entryFunction.trim() || 'tool',
			manifest,
			inputs,
			...(testCase.constants ? { constants: testCase.constants } : {}),
		});
		// A run that ended without results is read before comparing: comparing against nothing would
		// report a raised script as a value mismatch.
		if (!res.ran || !res.results) {
			return {
				rows: [],
				failure: res.failure ?? { message: 'the run produced no results', call: null, traceback: [] },
				results: null,
				passed: false,
			};
		}
		const rows = compareResults(testCase.expected, res.results, testCase.absent, tolerance);
		return { rows, failure: null, results: res.results, passed: allPassed(rows) };
	} catch (e) {
		return { rows: [], failure: toolRunFailure(e), results: null, passed: false };
	}
}
