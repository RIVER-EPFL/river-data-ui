import { createContext, useContext } from 'react';
import Keycloak from 'keycloak-js';

export const KeycloakContext = createContext<Keycloak | null>(null);
export const useKeycloak = () => useContext(KeycloakContext);
