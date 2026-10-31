/**
 * React Context and hook for application-wide user settings.
 */

import { createContext, useContext } from 'react';
import type { UserSettings } from '../../types/book';
import { DEFAULT_SETTINGS } from '../../types/book';

export interface SettingsContextValue {
  settings: UserSettings;
  loading: boolean;
  updateSettings: (partial: Partial<UserSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loading: true,
  updateSettings: async () => {},
  resetSettings: async () => {},
});

export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within a SettingsProvider');
  }
  return context;
}
