import { useDataProvider } from 'react-admin';
import type { RiverDataProvider } from './dataProvider';

export const useRiverDataProvider = () =>
  useDataProvider() as RiverDataProvider;
