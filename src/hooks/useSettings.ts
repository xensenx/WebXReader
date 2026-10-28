/**
 * Custom hook for managing user settings.
 * Loads browser-local preferences, applies theme, and provides update functions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { UserSettings, ThemeName } from '../types/book';
import { DEFAULT_SETTINGS } from '../types/book';
import { getSettings, saveSettings } from '../core/storage/database';

interface UseSettingsResult {
  settings: UserSettings;
  loading: boolean;
  updateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

function getSystemTheme(): ThemeName {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const settingsRef = useRef(settings);
  const settingsChangedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const stored = await getSettings();
        if (cancelled) return;

        if (!settingsChangedRef.current) {
          if (stored) {
            const merged = { ...DEFAULT_SETTINGS, ...stored };
            settingsRef.current = merged;
            setSettings(merged);
            applyTheme(merged.theme);
          } else {
            // No stored settings — apply system theme as default
            const systemTheme = getSystemTheme();
            const initial: UserSettings = { ...DEFAULT_SETTINGS, theme: systemTheme };
            settingsRef.current = initial;
            setSettings(initial);
            applyTheme(systemTheme);
          }
        }
      } catch {
        if (!settingsChangedRef.current) {
          const systemTheme = getSystemTheme();
          const initial: UserSettings = { ...DEFAULT_SETTINGS, theme: systemTheme };
          settingsRef.current = initial;
          setSettings(initial);
          applyTheme(systemTheme);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function handleChange(_e: MediaQueryListEvent) {
      // Only auto-switch if user hasn't explicitly chosen a theme
      // We detect this by checking if settings haven't been persisted yet
      // In practice the user's explicit choice is always persisted
    }

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const updateSettings = useCallback(async (partial: Partial<UserSettings>) => {
    settingsChangedRef.current = true;
    const merged: UserSettings = {
      ...settingsRef.current,
      ...partial,
      updatedAt: Date.now(),
    };
    settingsRef.current = merged;
    setSettings(merged);

    if (partial.theme) applyTheme(partial.theme);

    try {
      await saveSettings(merged);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, []);

  return {
    settings,
    loading,
    updateSettings,
  };
}
