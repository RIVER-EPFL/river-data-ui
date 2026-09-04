export interface PointRef {
	siteParameterId: string;
	timeIso: string;
	measurementType: 'continuous' | 'spot';
}

/** The open chart record as the site page's `?point=&t=&mt=` parameters; null when incomplete. */
export function readPointParams(params: URLSearchParams): PointRef | null {
	const point = params.get('point');
	const t = params.get('t');
	const mt = params.get('mt');
	if (!point || !t) return null;
	const ms = new Date(t).getTime();
	if (Number.isNaN(ms)) return null;
	if (mt !== 'continuous' && mt !== 'spot') return null;
	return { siteParameterId: point, timeIso: new Date(ms).toISOString(), measurementType: mt };
}

export function writePointParams(params: URLSearchParams, point: PointRef | null): void {
	if (!point) {
		params.delete('point');
		params.delete('t');
		params.delete('mt');
		return;
	}
	params.set('point', point.siteParameterId);
	params.set('t', point.timeIso);
	params.set('mt', point.measurementType);
}
