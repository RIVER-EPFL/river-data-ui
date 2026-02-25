import { AuthProvider } from 'react-admin';
import Keycloak, { KeycloakTokenParsed } from 'keycloak-js';
import { jwtDecode } from 'jwt-decode';

export type PermissionsFunction = (decoded: KeycloakTokenParsed) => unknown;

export const keycloakAuthProvider = (
  client: Keycloak,
  options: {
    onPermissions?: PermissionsFunction;
    loginRedirectUri?: string;
    logoutRedirectUri?: string;
  } = {}
): AuthProvider => ({
  async login() {
    return client.login({
      redirectUri: options.loginRedirectUri ?? window.location.origin,
    });
  },
  async logout() {
    return client.logout({
      redirectUri: options.logoutRedirectUri ?? window.location.origin,
    });
  },
  async checkError(error: { status?: number }) {
    if (error.status === 401 || error.status === 403) {
      throw new Error('Unauthorized');
    }
  },
  async checkAuth() {
    if (!client.authenticated || !client.token) {
      throw new Error('Not authenticated');
    }
    const decoded = jwtDecode(client.token);
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      await client.updateToken(360);
    }
  },
  async getPermissions() {
    if (!client.token) {
      return false;
    }
    const decoded = jwtDecode<KeycloakTokenParsed>(client.token);
    return options.onPermissions ? options.onPermissions(decoded) : decoded;
  },
  async getIdentity() {
    if (client.token) {
      const decoded = jwtDecode<KeycloakTokenParsed>(client.token);
      return {
        id: decoded.sub || '',
        fullName: decoded.preferred_username,
      };
    }
    return Promise.reject('Failed to get identity.');
  },
});
