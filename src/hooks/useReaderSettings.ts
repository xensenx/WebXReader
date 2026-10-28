/**
 * Custom hook for managing per-book reader settings merged with global defaults.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { UserSettings, BookSettings, ReadingMode, TextAlignment } from '../types/book';
import { DEFAULT_SETTINGS } from '../types/book';
import {
  getSettings,
  getBookSettings,
  saveBookSettings,
} from '../core/storage/database';

/** The effective reader settings after merging global + per-book overrides */
export interface EffectiveReaderSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  letterSpacing: number;
  wordSpacing: number;
  textAlign: TextAlignment;
  textIndent: number;
  maxContentWidth: number;
  contentMargin: number;
  readingMode: ReadingMode;
  theme: UserSettings['theme'];
}

/** Fields that can be overridden per-book */
export type ReaderSettingsUpdate = Partial<Omit<EffectiveReaderSettings, 'theme' | 'wordSpacing'>>;

interface UseReaderSettingsResult {
  settings: EffectiveReaderSettings;
  globalSettings: UserSettings;
  bookOverrides: BookSettings | null;
  loading: boolean;
  updateReaderSettings: (partial: ReaderSettingsUpdate) => Promise<void>;
  resetBookSettings: () => Promise<void>;
}

function mergeSettings(
  global: UserSettings,
  bookOverrides: BookSettings | null
): EffectiveReaderSettings {
  return {
    fontFamily: bookOverrides?.fontFamily ?? global.fontFamily,
    fontSize: bookOverrides?.fontSize ?? global.fontSize,
    lineHeight: bookOverrides?.lineHeight ?? global.lineHeight,
    paragraphSpacing: bookOverrides?.paragraphSpacing ?? global.paragraphSpacing,
    letterSpacing: bookOverrides?.letterSpacing ?? global.letterSpacing,
    wordSpacing: global.wordSpacing,
    textAlign: bookOverrides?.textAlign ?? global.textAlign,
    textIndent: bookOverrides?.textIndent ?? global.textIndent,
    maxContentWidth: bookOverrides?.maxContentWidth ?? global.maxContentWidth,
    contentMargin: bookOverrides?.contentMargin ?? global.contentMargin,
    readingMode: bookOverrides?.readingMode ?? global.defaultReadingMode,
    theme: global.theme,
  };
}

export function useReaderSettings(bookId: string): UseReaderSettingsResult {
  const [globalSettings, setGlobalSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [bookOverrides, setBookOverrides] = useState<BookSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBookOverrides(null);

    async function load() {
      try {
        const [global, bookSetting] = await Promise.all([
          getSettings(),
          getBookSettings(bookId),
        ]);

        if (!cancelled) {
          setGlobalSettings(global ? { ...DEFAULT_SETTINGS, ...global } : DEFAULT_SETTINGS);
          setBookOverrides(bookSetting ?? null);
        }
      } catch (err) {
        console.error('Failed to load reader settings:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const settings = useMemo(
    () => mergeSettings(globalSettings, bookOverrides),
    [globalSettings, bookOverrides]
  );

  const updateReaderSettings = useCallback(
    async (partial: ReaderSettingsUpdate) => {
      const newOverrides: BookSettings = {
        ...(bookOverrides ?? { bookId, updatedAt: Date.now() }),
        bookId,
        ...partial,
        updatedAt: Date.now(),
      };

      setBookOverrides(newOverrides);

      try {
        await saveBookSettings(newOverrides);
      } catch (err) {
        console.error('Failed to save book settings:', err);
      }
    },
    [bookId, bookOverrides]
  );

  const resetBookSettings = useCallback(async () => {
    const empty: BookSettings = {
      bookId,
      updatedAt: Date.now(),
    };

    setBookOverrides(null);

    try {
      await saveBookSettings(empty);
    } catch (err) {
      console.error('Failed to reset book settings:', err);
    }
  }, [bookId]);

  return {
    settings,
    globalSettings,
    bookOverrides,
    loading,
    updateReaderSettings,
    resetBookSettings,
  };
}
