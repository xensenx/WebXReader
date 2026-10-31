/**
 * Settings context provider.
 * Makes user settings available throughout the component tree.
 */

import React from 'react';
import { useSettings } from '../../hooks/useSettings';
import {
  SettingsContext,
  useSettingsContext,
  type SettingsContextValue,
} from './useSettingsContext';

export { useSettingsContext, type SettingsContextValue };

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
