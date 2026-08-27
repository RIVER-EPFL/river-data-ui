/**
 * Where the vendored portal functions end inside a stored tool script.
 *
 * A version stores one script. The seeds build it as the wrapper preceded by only the prelude
 * functions it calls, and nothing in the text marks that join, so the boundary is recovered by
 * reading the prelude's own provenance: every
 * vendored block opens with the line `# Source: cnet-data-portal (MIT, mclement18)`, and each block
 * is a top-level function closing on a bare `}`. The prelude is therefore the run from the top of
 * the script through the close of the last vendored block, plus the blank lines before the author's
 * first line.
 *
 * Matching the prelude text instead was tried and rejected: the seed migration inserts a version
 * once and never revisits it, so a database holds whichever revision of `prelude.R` was current when
 * it was first migrated. The dev database and the working tree already disagree by 25 lines, which
 * a text or hash match would read as "no prelude here" on every seeded script.
 *
 * Detection fails safe by requiring the script to *open* with that provenance line. A script written
 * from scratch in the portal does not, so it reports no prelude at all and stays a plain document
 * with every line editable. A seeded tool that calls none of the portal functions (discharge) is
 * read the same way, correctly: it carries none.
 */

/** The provenance line each vendored block carries, copied from the portal's own header. */
const VENDOR_MARKER = '# Source: cnet-data-portal';

export interface ScriptStructure {
	/**
	 * Offset of the newline closing the prelude, which is the last position the guard protects.
	 * Null when the script carries no prelude.
	 */
	preludeEnd: number | null;
	/** Lines the prelude occupies, 0 when the script carries none. */
	preludeLines: number;
	/** 1-based line defining the entry function the runner calls, or null when it defines none. */
	entryLine: number | null;
	totalLines: number;
	/** Lines the author owns: the whole script when there is no prelude. */
	authoredLines: number;
}

/** Lines the vendored prelude occupies at the top of `lines`, or 0 when it opens with none. */
function preludeLineCount(lines: string[]): number {
	if (lines.length === 0 || !lines[0].startsWith(VENDOR_MARKER)) return 0;
	let lastMarker = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith(VENDOR_MARKER)) lastMarker = i;
	}
	// The vendored functions are top level, so nested closes are indented and the first bare `}`
	// after the last provenance line closes the last vendored block.
	let close = -1;
	for (let i = lastMarker + 1; i < lines.length; i++) {
		if (lines[i] === '}') {
			close = i;
			break;
		}
	}
	if (close < 0) return 0;
	let end = close;
	while (end + 1 < lines.length && lines[end + 1].trim() === '') end++;
	// A script that is nothing but vendored blocks has no authored part to open on.
	return end + 1 >= lines.length ? 0 : end + 1;
}

function escapeForRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The 1-based line defining `entry`. The last definition wins because that is the one left bound
 * when the script is sourced, and therefore the one the runner calls.
 */
export function entryDefinitionLine(script: string, entry: string): number | null {
	const name = entry.trim();
	if (!name) return null;
	const escaped = escapeForRegExp(name);
	const pattern = new RegExp(`^\\s*(?:${escaped}|\`${escaped}\`)\\s*(?:<-|=)\\s*function\\b`);
	const lines = script.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		if (pattern.test(lines[i])) return i + 1;
	}
	return null;
}

export function describeScript(script: string, entry: string): ScriptStructure {
	const lines = script.split('\n');
	const totalLines = script.length === 0 ? 0 : lines.length;
	const preludeLines = preludeLineCount(lines);
	let preludeEnd: number | null = null;
	if (preludeLines > 0) {
		let offset = 0;
		for (let i = 0; i < preludeLines; i++) offset += lines[i].length + 1;
		// The newline itself, so deleting it cannot merge the author's first line into the prelude,
		// while the position right after it stays writable.
		preludeEnd = offset - 1;
	}
	return {
		preludeEnd,
		preludeLines,
		entryLine: entryDefinitionLine(script, entry),
		totalLines,
		authoredLines: totalLines - preludeLines,
	};
}
