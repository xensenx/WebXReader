/**
 * Settings context provider.
 * Makes user settings available throughout the component tree.
 */

import React, { createContext, useContext } from 'react';
import type { UserSettings } from '../../types/book';
import { DEFAULT_SETTINGS } from '../../types/book';
import { useSettings } from '../../hooks/useSettings';

interface SettingsContextValue {
  settings: UserSettings;
  loading: boolean;
  updateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loading: true,
  updateSettings: async () => {},
});

interface SettingsProviderProps {
  children: React.ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const settingsState = useSettings();

  return (
    <SettingsContext.Provider value={settingsState}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within a SettingsProvider');
  }
  return context;
}
