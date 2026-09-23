/** One arm's pending marks placed on the chart's union time axis, or null when the arm has none. */
export function pendingOnUnion(
	times: number[],
	pending: (boolean | null)[] | null | undefined,
	unionIndex: Map<number, number>,
	length: number,
): (boolean | null)[] | null {
	if (!pending || !pending.some((p) => p === true)) return null;
	const out = new Array<boolean | null>(length).fill(null);
	for (let i = 0; i < times.length; i++) {
		const j = unionIndex.get(times[i]);
		if (j != null && pending[i] === true) out[j] = true;
	}
	return out;
}
