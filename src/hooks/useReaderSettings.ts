/**
 * Custom hook for managing per-book reader settings merged with global defaults.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  UserSettings,
  BookSettings,
  ReadingMode,
  TextAlignment,
  ComicReadingDirection,
  ComicFitMode,
  ReaderSheetColor,
  BookFormat,
  FormatSettings,
} from '../types/book';
import { DEFAULT_SETTINGS } from '../types/book';
import {
  getSettings,
  saveSettings,
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
  comicReadingDirection?: ComicReadingDirection;
  comicFitMode?: ComicFitMode;
  rtfPreserveAlignment?: boolean;
  readerSheetColor: ReaderSheetColor;
  expandContent: boolean;
}

/** Fields that can be overridden per-book */
export type ReaderSettingsUpdate = Partial<Omit<EffectiveReaderSettings, 'theme' | 'wordSpacing'>>;

export interface UseReaderSettingsResult {
  settings: EffectiveReaderSettings;
  globalSettings: UserSettings;
  bookOverrides: BookSettings | null;
  loading: boolean;
  isCustomBook: boolean;
  setIsCustomBook: (custom: boolean) => Promise<void>;
  updateReaderSettings: (partial: ReaderSettingsUpdate) => Promise<void>;
  resetBookSettings: () => Promise<void>;
}

function hasCustomOverride(bookOverrides: BookSettings | null, format?: BookFormat): boolean {
  if (!bookOverrides) return false;
  if (bookOverrides.isCustomOverride !== undefined) {
    return bookOverrides.isCustomOverride;
  }
  // When no format is passed (legacy hook usage), any present override is honored.
  return !format;
}

function mergeSettings(
  global: UserSettings,
  bookOverrides: BookSettings | null,
  format?: BookFormat
): EffectiveReaderSettings {
  const hasCustom = hasCustomOverride(bookOverrides, format);
  const fmt = (format && global.formatSettings?.[format]) || undefined;

  return {
    fontFamily:
      (hasCustom && bookOverrides?.fontFamily !== undefined)
        ? bookOverrides.fontFamily
        : (fmt?.fontFamily ?? global.fontFamily),
    fontSize:
      (hasCustom && bookOverrides?.fontSize !== undefined)
        ? bookOverrides.fontSize
        : (fmt?.fontSize ?? global.fontSize),
    lineHeight:
      (hasCustom && bookOverrides?.lineHeight !== undefined)
        ? bookOverrides.lineHeight
        : (fmt?.lineHeight ?? global.lineHeight),
    paragraphSpacing:
      (hasCustom && bookOverrides?.paragraphSpacing !== undefined)
        ? bookOverrides.paragraphSpacing
        : (fmt?.paragraphSpacing ?? global.paragraphSpacing),
    letterSpacing:
      (hasCustom && bookOverrides?.letterSpacing !== undefined)
        ? bookOverrides.letterSpacing
        : (fmt?.letterSpacing ?? global.letterSpacing),
    wordSpacing: global.wordSpacing,
    textAlign:
      (hasCustom && bookOverrides?.textAlign !== undefined)
        ? bookOverrides.textAlign
        : (fmt?.textAlign ?? global.textAlign),
    textIndent:
      (hasCustom && bookOverrides?.textIndent !== undefined)
        ? bookOverrides.textIndent
        : (fmt?.textIndent ?? global.textIndent),
    maxContentWidth:
      (hasCustom && bookOverrides?.maxContentWidth !== undefined)
        ? bookOverrides.maxContentWidth
        : (fmt?.maxContentWidth ?? global.maxContentWidth),
    contentMargin:
      (hasCustom && bookOverrides?.contentMargin !== undefined)
        ? bookOverrides.contentMargin
        : (fmt?.contentMargin ?? global.contentMargin),
    readingMode:
      (hasCustom && bookOverrides?.readingMode !== undefined)
        ? bookOverrides.readingMode
        : (fmt?.readingMode ?? global.defaultReadingMode),
    theme: global.theme,
    comicReadingDirection:
      (hasCustom && bookOverrides?.comicReadingDirection !== undefined)
        ? bookOverrides.comicReadingDirection
        : (fmt?.comicReadingDirection ?? bookOverrides?.comicReadingDirection),
    comicFitMode:
      (hasCustom && bookOverrides?.comicFitMode !== undefined)
        ? bookOverrides.comicFitMode
        : (fmt?.comicFitMode ?? bookOverrides?.comicFitMode),
    rtfPreserveAlignment:
      (hasCustom && bookOverrides?.rtfPreserveAlignment !== undefined)
        ? bookOverrides.rtfPreserveAlignment
        : (fmt?.rtfPreserveAlignment ?? bookOverrides?.rtfPreserveAlignment ?? true),
    readerSheetColor:
      (hasCustom && bookOverrides?.readerSheetColor !== undefined)
        ? bookOverrides.readerSheetColor
        : (fmt?.readerSheetColor ?? global.readerSheetColor ?? 'paper'),
    expandContent:
      (hasCustom && bookOverrides?.expandContent !== undefined)
        ? bookOverrides.expandContent
        : (fmt?.expandContent ?? global.expandContent ?? false),
  };
}

export function useReaderSettings(bookId: string, format?: BookFormat): UseReaderSettingsResult {
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
    () => mergeSettings(globalSettings, bookOverrides, format),
    [globalSettings, bookOverrides, format]
  );

  const isCustomBook = format
    ? Boolean(bookOverrides?.isCustomOverride)
    : true;

  const updateReaderSettings = useCallback(
    async (partial: ReaderSettingsUpdate) => {
      if (format && !isCustomBook) {
        // Universal format setting for this format
        const currentFmt = globalSettings.formatSettings?.[format] ?? {};
        const updatedFmt: FormatSettings = { ...currentFmt, ...partial };
        const updatedGlobal: UserSettings = {
          ...globalSettings,
          formatSettings: {
            ...(globalSettings.formatSettings ?? {}),
            [format]: updatedFmt,
          },
          updatedAt: Date.now(),
        };

        setGlobalSettings(updatedGlobal);

        try {
          await saveSettings(updatedGlobal);
        } catch (err) {
          console.error('Failed to save format settings:', err);
        }
      } else {
        // Book-specific override
        const newOverrides: BookSettings = {
          ...(bookOverrides ?? { bookId, updatedAt: Date.now() }),
          bookId,
          ...(format ? { isCustomOverride: true } : {}),
          ...partial,
          updatedAt: Date.now(),
        };

        setBookOverrides(newOverrides);

        try {
          await saveBookSettings(newOverrides);
        } catch (err) {
          console.error('Failed to save book settings:', err);
        }
      }
    },
    [bookId, bookOverrides, isCustomBook, format, globalSettings]
  );

  const setIsCustomBook = useCallback(
    async (custom: boolean) => {
      if (custom) {
        const snapshot: BookSettings = {
          bookId,
          isCustomOverride: true,
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          paragraphSpacing: settings.paragraphSpacing,
          letterSpacing: settings.letterSpacing,
          textAlign: settings.textAlign,
          textIndent: settings.textIndent,
          maxContentWidth: settings.maxContentWidth,
          contentMargin: settings.contentMargin,
          readingMode: settings.readingMode,
          comicReadingDirection: settings.comicReadingDirection,
          comicFitMode: settings.comicFitMode,
          rtfPreserveAlignment: settings.rtfPreserveAlignment,
          readerSheetColor: settings.readerSheetColor,
          expandContent: settings.expandContent,
          updatedAt: Date.now(),
        };

        setBookOverrides(snapshot);

        try {
          await saveBookSettings(snapshot);
        } catch (err) {
          console.error('Failed to enable custom book settings:', err);
        }
      } else {
        const reset: BookSettings = {
          bookId,
          isCustomOverride: false,
          updatedAt: Date.now(),
        };

        setBookOverrides(null);

        try {
          await saveBookSettings(reset);
        } catch (err) {
          console.error('Failed to disable custom book settings:', err);
        }
      }
    },
    [bookId, settings]
  );

  const resetBookSettings = useCallback(async () => {
    if (format && !isCustomBook) {
      const nextFormatSettings = { ...(globalSettings.formatSettings || {}) };
      delete nextFormatSettings[format];
      const updatedGlobal: UserSettings = {
        ...globalSettings,
        formatSettings: nextFormatSettings,
        updatedAt: Date.now(),
      };
      setGlobalSettings(updatedGlobal);
      try {
        await saveSettings(updatedGlobal);
      } catch (err) {
        console.error('Failed to reset format settings:', err);
      }
      return;
    }

    const empty: BookSettings = {
      bookId,
      isCustomOverride: false,
      updatedAt: Date.now(),
    };

    setBookOverrides(null);

    try {
      await saveBookSettings(empty);
    } catch (err) {
      console.error('Failed to reset book settings:', err);
    }
  }, [bookId, format, isCustomBook, globalSettings]);

  return {
    settings,
    globalSettings,
    bookOverrides,
    loading,
    isCustomBook,
    setIsCustomBook,
    updateReaderSettings,
    resetBookSettings,
  };
}
