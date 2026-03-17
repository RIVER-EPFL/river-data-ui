import { useCallback } from 'react';
import { useKeycloak } from '../KeycloakContext';

export const useAuthFetch = () => {
  const keycloak = useKeycloak();
  return useCallback(
    (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      if (keycloak?.token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${keycloak.token}`);
      }
      return fetch(url, { ...init, headers });
    },
    [keycloak?.token],
  );
};
