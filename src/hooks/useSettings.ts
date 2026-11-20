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
  resetSettings: () => Promise<void>;
}

function applyTheme(theme: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const background = getComputedStyle(root).getPropertyValue('--color-bg').trim();
  if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
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
        if (cancelled || settingsChangedRef.current) return;
        const initial = stored ?? DEFAULT_SETTINGS;
        settingsRef.current = initial;
        setSettings(initial);
        applyTheme(initial.theme);
      } catch {
        if (!cancelled && !settingsChangedRef.current) applyTheme(DEFAULT_SETTINGS.theme);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const resetSettings = useCallback(async () => {
    settingsChangedRef.current = true;
    const initial: UserSettings = {
      ...DEFAULT_SETTINGS,
      updatedAt: Date.now(),
    };
    settingsRef.current = initial;
    setSettings(initial);
    applyTheme(initial.theme);

    try {
      await saveSettings(initial);
    } catch (err) {
      console.error('Failed to reset settings:', err);
    }
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
      throw err;
    }
  }, []);

  return {
    settings,
    loading,
    updateSettings,
    resetSettings,
  };
}
