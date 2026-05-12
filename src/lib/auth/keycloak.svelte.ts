import Keycloak, { type KeycloakTokenParsed } from 'keycloak-js';
import { jwtDecode } from 'jwt-decode';

type AuthState =
	| { status: 'loading' }
	| { status: 'no-auth' }
	| { status: 'authenticated'; keycloak: Keycloak }
	| { status: 'error'; message: string };

let state = $state<AuthState>({ status: 'loading' });
let initStarted = false;

function getRole(decoded: KeycloakTokenParsed): string | false {
	const roles = decoded?.realm_access?.roles;
	if (!roles) return false;
	if (roles.includes('admin')) return 'admin';
	if (roles.includes('user')) return 'user';
	return false;
}

export const auth = {
	get state() {
		return state;
	},
	get authenticated() {
		return state.status === 'authenticated' || state.status === 'no-auth';
	},
	get keycloak() {
		return state.status === 'authenticated' ? state.keycloak : null;
	},
	get token() {
		return state.status === 'authenticated' ? state.keycloak.token : undefined;
	},
	get role() {
		if (state.status === 'no-auth') return 'admin';
		if (state.status !== 'authenticated' || !state.keycloak.token) return false;
		const decoded = jwtDecode<KeycloakTokenParsed>(state.keycloak.token);
		return getRole(decoded);
	},
	get identity() {
		if (state.status === 'no-auth') return { id: 'local', fullName: 'Local User' };
		if (state.status !== 'authenticated' || !state.keycloak.token) return null;
		const decoded = jwtDecode<KeycloakTokenParsed>(state.keycloak.token);
		return { id: decoded.sub ?? '', fullName: decoded.preferred_username ?? '' };
	},

	async init() {
		if (initStarted) return;
		initStarted = true;

		try {
			const response = await fetch('/api/config/keycloak');
			if (!response.ok) {
				console.info('No Keycloak configured, running in no-auth mode');
				state = { status: 'no-auth' };
				return;
			}

			const config = await response.json();
			const browserUrl = import.meta.env.VITE_KEYCLOAK_BROWSER_URL;
			if (browserUrl) {
				config.url = browserUrl;
			}

			const keycloak = new Keycloak({
				url: config.url,
				realm: config.realm,
				clientId: config.clientId,
			});

			await keycloak.init({
				onLoad: 'login-required',
				checkLoginIframe: false,
				enableLogging: true,
				pkceMethod: 'S256',
			});

			state = { status: 'authenticated', keycloak };
		} catch (error) {
			console.error('Failed to initialize auth:', error);
			state = {
				status: 'error',
				message:
					'Failed to initialize authentication. Please check your network connection and try again.',
			};
		}
	},

	async ensureToken() {
		if (state.status !== 'authenticated') return;
		const decoded = jwtDecode(state.keycloak.token!);
		if (decoded.exp && decoded.exp * 1000 < Date.now() + 360_000) {
			await state.keycloak.updateToken(360);
		}
	},

	login() {
		if (state.status !== 'authenticated') return;
		const redirectUri = window.location.origin + '/admin/';
		state.keycloak.login({ redirectUri });
	},

	logout() {
		if (state.status !== 'authenticated') return;
		const redirectUri = window.location.origin + '/admin/';
		state.keycloak.logout({ redirectUri });
	},
};
