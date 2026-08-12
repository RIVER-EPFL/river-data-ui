import { GET } from '$api/client';
import { auth } from '$auth/keycloak.svelte';

// The caller's identity, access level and project visibility, sourced from the API's `/api/me`.
// Roles come from Keycloak (the API resolves them); grants (which projects a non-admin may see and
// act in) live in the API's `user_project_grants`. This store is the UI's single source of truth
// for "what may this user do and see", mirroring the API's capability policy so the shell can gate
// nav and pages without a second guess at the JWT.

export type Grant = { project_id: string; name: string };
export type MeData = {
	sub: string;
	email: string | null;
	is_admin: boolean;
	// 'administrator' | 'manager' | 'river' | 'intern'
	role: string;
	grants: Grant[];
};

export type Capability =
	| 'readMetadata'
	| 'readData'
	| 'writeData'
	| 'writeFieldMetadata'
	| 'manageSensors'
	| 'writeCatalog'
	| 'admin';

// Ordered access levels, matching the API's `Role::level()`.
const ROLE_LEVEL: Record<string, number> = {
	intern: 1,
	river: 2,
	manager: 3,
	administrator: 4,
};

// The minimum level that holds each capability, matching the API's `Capability::min_role()`.
const CAP_MIN_LEVEL: Record<Capability, number> = {
	readMetadata: 1,
	readData: 1,
	writeData: 2,
	writeFieldMetadata: 2,
	manageSensors: 3,
	writeCatalog: 3,
	admin: 4,
};

type MeState =
	| { status: 'loading' }
	| { status: 'ready'; me: MeData }
	| { status: 'forbidden' }
	| { status: 'error'; message: string };

// In local no-auth mode the API has no Keycloak and `/api/me` isn't callable, so mirror the auth
// store's synthetic-admin behaviour: full access.
const LOCAL_ADMIN: MeData = {
	sub: 'local',
	email: null,
	is_admin: true,
	role: 'administrator',
	grants: [],
};

let state = $state<MeState>({ status: 'loading' });
let started = false;

function levelOf(role: string): number {
	return ROLE_LEVEL[role] ?? 0;
}

export const me = {
	get state() {
		return state;
	},
	get status() {
		return state.status;
	},
	get data(): MeData | null {
		return state.status === 'ready' ? state.me : null;
	},
	get role(): string {
		return state.status === 'ready' ? state.me.role : '';
	},
	get level(): number {
		return state.status === 'ready' ? levelOf(state.me.role) : 0;
	},
	get isAdmin(): boolean {
		return state.status === 'ready' && state.me.is_admin;
	},
	get grants(): Grant[] {
		return state.status === 'ready' ? state.me.grants : [];
	},

	/** Whether the caller's level holds a capability (project-agnostic; grants confine *where*). */
	can(cap: Capability): boolean {
		return this.level >= CAP_MIN_LEVEL[cap];
	},

	/** Whether the caller may see/act in a project, admins everywhere, others only where granted. */
	granted(projectId: string | null | undefined): boolean {
		if (this.isAdmin) return true;
		if (!projectId) return false;
		return this.grants.some((g) => g.project_id === projectId);
	},

	/**
	 * Load `/api/me` once auth is ready. Idempotent and safe to call from an effect: it no-ops until
	 * auth resolves, then fetches exactly once. Local no-auth mode resolves to a synthetic admin.
	 */
	async ensure() {
		if (started) return;
		const s = auth.state.status;
		if (s === 'no-auth') {
			started = true;
			state = { status: 'ready', me: LOCAL_ADMIN };
			return;
		}
		if (s !== 'authenticated') return;
		started = true;
		try {
			state = { status: 'ready', me: await GET<MeData>('/api/me') };
		} catch {
			// The access gate (auth.role === false) already renders the Unauthorized page for a
			// role-less login; a 403 here just marks the store forbidden.
			state = { status: 'forbidden' };
		}
	},

	/** Re-fetch after a grant/role change (admin editing another user doesn't affect self, but a
	 *  self role change or a fresh login should re-resolve). */
	async refresh() {
		if (auth.state.status !== 'authenticated') return;
		try {
			state = { status: 'ready', me: await GET<MeData>('/api/me') };
		} catch {
			state = { status: 'forbidden' };
		}
	},
};
