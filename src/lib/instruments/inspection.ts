import type { InstrumentOverview, InstrumentStreamRef } from '$api/service';

export function instrumentInspection(
	instruments: InstrumentOverview[],
	sensorId: string,
): InstrumentOverview | null {
	return instruments.find((instrument) => instrument.id === sensorId) ?? null;
}

export function streamInspectionHref(stream: InstrumentStreamRef, basePath = ''): string {
	const params = new URLSearchParams({
		source: stream.source_system,
		q: stream.source_key,
	});
	return `${basePath}/streams?${params.toString()}`;
}

export function legacyInstrumentTabHref(tab: string | null, basePath = ''): string | null {
	return tab === 'instruments' ? `${basePath}/sensors` : null;
}
