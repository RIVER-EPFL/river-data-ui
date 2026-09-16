import { getCollectionEventDetail, type EventDetailResponse } from '$api/service';
import { api } from '$api/crud';

// The staged field visit: one (station, collection instant) every tool writes into, held for the
// session so a visit is staged once and several tools attach to it in turn. It is the portal's
// Field Data row, kept beside the tools instead of behind a separate screen.

const STORAGE_KEY = 'river-data-staged-visit';

export interface StagedVisit {
	eventId: string;
	siteId: string;
	siteName: string;
	/** RFC 3339, the event's `collected_at`. */
	collectedAt: string;
}

/**
 * The staged visit a calculation is opened at: the tool page reads its context from the store, so
 * opening a computation from the table means staging exactly the visit being read.
 */
export function stagedVisitFrom(
	detail: { id: string; site_id: string; collected_at: string },
	siteName: string,
): StagedVisit {
	return {
		eventId: detail.id,
		siteId: detail.site_id,
		siteName,
		collectedAt: detail.collected_at,
	};
}

function load(): StagedVisit | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as Partial<StagedVisit>;
		if (!v.eventId || !v.siteId || !v.collectedAt) return null;
		return { eventId: v.eventId, siteId: v.siteId, siteName: v.siteName ?? '', collectedAt: v.collectedAt };
	} catch {
		return null;
	}
}

let current = $state<StagedVisit | null>(load());
let detail = $state<EventDetailResponse | null>(null);
let detailLoading = $state(false);

function persist() {
	if (typeof sessionStorage === 'undefined') return;
	if (current) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
	else sessionStorage.removeItem(STORAGE_KEY);
}

export const stagedVisit = {
	get current(): StagedVisit | null {
		return current;
	},
	/** What the visit already records, for the "already entered" summary. Null until loaded. */
	get detail(): EventDetailResponse | null {
		return detail;
	},
	get detailLoading(): boolean {
		return detailLoading;
	},

	set(visit: StagedVisit) {
		current = visit;
		detail = null;
		persist();
		void this.refresh();
	},

	clear() {
		current = null;
		detail = null;
		persist();
	},

	async discard(eventId: string) {
		await api.collectionEvents.remove(eventId);
		if (current?.eventId === eventId) this.clear();
	},

	/** Re-read the event's grid; call after a save so the summary shows what just landed. */
	async refresh() {
		if (!current) return;
		const id = current.eventId;
		detailLoading = true;
		try {
			const res = await getCollectionEventDetail(id);
			if (current?.eventId === id) detail = res;
		} catch {
			if (current?.eventId === id) detail = null;
		} finally {
			detailLoading = false;
		}
	},
};
