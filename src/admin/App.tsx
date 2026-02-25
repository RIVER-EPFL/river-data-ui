import { useState, useRef, useEffect } from 'react';
import { Admin, Resource, CustomRoutes, defaultTheme } from 'react-admin';
import { Route } from 'react-router';
import { fetchUtils } from 'ra-core';
import Keycloak from 'keycloak-js';
import { httpClient } from 'ra-keycloak';
import { keycloakAuthProvider } from './authProvider';
import simpleRestProvider from './dataProvider';
import CustomLayout from './Layout';
import Dashboard from './Dashboard';
import { resources, hiddenResources } from './resources';
import { SystemPage } from './resources/system';
import { KeycloakContext } from './KeycloakContext';

const initOptions = {
  onLoad: 'login-required' as const,
  checkLoginIframe: false,
  enableLogging: true,
  silentCheckSsoRedirectUri: undefined,
  pkceMethod: 'S256' as const,
};

const getPermissions = (decoded: { realm_access?: { roles?: string[] } }) => {
  const roles = decoded?.realm_access?.roles;
  if (!roles) return false;
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('user')) return 'user';
  return false;
};

export const apiUrl = '/api/admin';

type InitState =
  | { status: 'loading' }
  | { status: 'no-auth' }
  | { status: 'keycloak'; keycloak: Keycloak }
  | { status: 'error'; message: string };

const AdminApp = () => {
  const [initState, setInitState] = useState<InitState>({ status: 'loading' });
  const initPromise = useRef<Promise<void> | undefined>(undefined);
  const authProvider = useRef<ReturnType<typeof keycloakAuthProvider> | undefined>(undefined);
  const dataProviderRef = useRef<ReturnType<typeof simpleRestProvider> | undefined>(undefined);

  useEffect(() => {
    const init = async () => {
      try {
        // Try to fetch Keycloak config from the API
        const response = await fetch('/api/config/keycloak');

        if (!response.ok) {
          // No Keycloak configured — fall back to no-auth mode
          console.info('No Keycloak configured, running in no-auth mode');
          dataProviderRef.current = simpleRestProvider(apiUrl, fetchUtils.fetchJson);
          setInitState({ status: 'no-auth' });
          return;
        }

        const keycloakConfig = await response.json();
        const browserKeycloakUrl = import.meta.env.VITE_KEYCLOAK_BROWSER_URL;
        if (browserKeycloakUrl) {
          keycloakConfig.url = browserKeycloakUrl;
        }

        const keycloakClient = new Keycloak({
          url: keycloakConfig.url,
          realm: keycloakConfig.realm,
          clientId: keycloakConfig.clientId,
        });

        await keycloakClient.init(initOptions);

        const redirectUri = window.location.origin + '/admin';

        authProvider.current = keycloakAuthProvider(keycloakClient, {
          onPermissions: getPermissions,
          loginRedirectUri: redirectUri,
          logoutRedirectUri: redirectUri,
        });
        dataProviderRef.current = simpleRestProvider(apiUrl, httpClient(keycloakClient));
        setInitState({ status: 'keycloak', keycloak: keycloakClient });
      } catch (error) {
        console.error('Failed to initialize:', error);
        setInitState({
          status: 'error',
          message: 'Failed to initialize authentication. Please check your network connection and try again.',
        });
      }
    };

    if (!initPromise.current) {
      initPromise.current = init();
    }
  }, []);

  if (initState.status === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          fontSize: '18px',
          color: '#d32f2f',
          textAlign: 'center',
          padding: '20px',
        }}
      >
        <p>Authentication Error</p>
        <p style={{ fontSize: '14px', marginTop: '10px', color: '#666', maxWidth: '400px' }}>
          {initState.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '20px',
            padding: '10px 20px',
            backgroundColor: '#2E7D87',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (initState.status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          fontSize: '18px',
          color: '#666',
        }}
      >
        <p>Loading River Data Admin...</p>
        <p style={{ fontSize: '14px', marginTop: '10px', color: '#999' }}>
          Initializing...
        </p>
      </div>
    );
  }

  const theme = {
    ...defaultTheme,
    sidebar: { width: 200 },
  };

  return (
    <KeycloakContext.Provider value={initState.status === 'keycloak' ? initState.keycloak : null}>
      <Admin
        authProvider={authProvider.current}
        dataProvider={dataProviderRef.current as NonNullable<typeof dataProviderRef.current>}
        title="River Data: Admin"
        layout={CustomLayout}
        theme={theme}
        dashboard={Dashboard}
        basename="/admin"
      >
        {resources.map((r) => (
          <Resource key={r.name} {...r} />
        ))}
        {hiddenResources.map((r) => (
          <Resource key={r.name} {...r} />
        ))}
        <CustomRoutes>
          <Route path="/system" element={<SystemPage />} />
        </CustomRoutes>
      </Admin>
    </KeycloakContext.Provider>
  );
};

export default AdminApp;
