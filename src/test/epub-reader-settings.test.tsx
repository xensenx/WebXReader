import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { ReaderSettings } from '../components/reader/ReaderSettings';
import { useReaderSettings } from '../hooks/useReaderSettings';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';
import {
  clearDatabase,
  clearSettings,
  getSettings,
} from '../core/storage/database';

describe('EPUB Reader Settings Enhancements', () => {
  const dummySettings: EffectiveReaderSettings = {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 1.7,
    paragraphSpacing: 1.0,
    letterSpacing: 0,
    wordSpacing: 0,
    textAlign: 'left',
    textIndent: 0,
    maxContentWidth: 720,
    contentMargin: 24,
    readingMode: 'scroll',
    theme: 'light',
    readerSheetColor: 'paper',
    expandContent: false,
  };

  describe('ReaderSettings component for EPUB', () => {
    it('renders Reading Mode options (Vertical Scroll and Double Sided) without Pages or Contracted / Expanded controls for EPUB', () => {
      const handleUpdate = vi.fn();
      const { rerender } = render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="epub"
        />
      );

      // Primary reading modes for EPUB: Vertical Scroll and Double Sided only
      const scrollBtn = screen.getByRole('button', { name: /vertical scroll/i });
      const doubleSidedBtn = screen.getByRole('button', { name: /double sided/i });

      expect(scrollBtn).toBeInTheDocument();
      expect(doubleSidedBtn).toBeInTheDocument();

      // Pages mode is removed for EPUB
      expect(screen.queryByRole('button', { name: /^pages$/i })).not.toBeInTheDocument();

      // Contracted Mode and Expanded Mode are removed for EPUB since Page Width slider is offered
      expect(screen.queryByRole('button', { name: /contracted mode/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /expanded mode/i })).not.toBeInTheDocument();

      // Click Double Sided
      fireEvent.click(doubleSidedBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'vertical' });

      // Rerender with readingMode: 'vertical'
      rerender(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, readingMode: 'vertical' }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="epub"
        />
      );

      expect(doubleSidedBtn.className).toMatch(/modeBtnActive/);
      expect(scrollBtn.className).not.toMatch(/modeBtnActive/);

      // Click Vertical Scroll
      fireEvent.click(scrollBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'scroll' });
    });

    it('renders Pages button for non-EPUB formats like CBZ', () => {
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={vi.fn()}
          onReset={vi.fn()}
          format="cbz"
        />
      );

      expect(screen.getByRole('button', { name: /^pages$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /vertical scroll/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /double sided/i })).toBeInTheDocument();
    });

    it('renders Page Canvas color options (Paper White, Archive Gold, Dark) and toggles readerSheetColor', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="epub"
        />
      );

      expect(screen.getByText('Page Canvas')).toBeInTheDocument();
      const paperBtn = screen.getByRole('button', { name: /paper white/i });
      const archiveBtn = screen.getByRole('button', { name: /archive gold/i });
      const darkBtn = screen.getByRole('button', { name: /^dark$/i });

      expect(paperBtn).toBeInTheDocument();
      expect(archiveBtn).toBeInTheDocument();
      expect(darkBtn).toBeInTheDocument();

      fireEvent.click(archiveBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readerSheetColor: 'archive' });

      fireEvent.click(darkBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readerSheetColor: 'dark' });

      fireEvent.click(paperBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readerSheetColor: 'paper' });
    });

    it('renders "This Book Only" toggle hint as "Settings apply to all EPUB books." when format is epub', () => {
      const handleToggle = vi.fn();
      const { rerender } = render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={vi.fn()}
          onReset={vi.fn()}
          format="epub"
          isCustomBook={false}
          onToggleCustomBook={handleToggle}
        />
      );

      expect(screen.getByText('This Book Only')).toBeInTheDocument();
      expect(screen.getByText('Settings apply to all EPUB books.')).toBeInTheDocument();

      const switchBtn = screen.getByRole('switch', { name: /this book only/i });
      expect(switchBtn).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(switchBtn);
      expect(handleToggle).toHaveBeenCalledWith(true);

      // Re-render as custom book
      rerender(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={vi.fn()}
          onReset={vi.fn()}
          format="epub"
          isCustomBook={true}
          onToggleCustomBook={handleToggle}
        />
      );

      expect(screen.getByText('Settings apply only to this book.')).toBeInTheDocument();
      expect(switchBtn).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('useReaderSettings hook with EPUB format', () => {
    const book1Id = 'book-epub-1';
    const book2Id = 'book-epub-2';
    const book3Id = 'book-epub-3';

    beforeEach(async () => {
      await clearDatabase();
      await clearSettings();
    });

    afterEach(async () => {
      await clearDatabase();
      await clearSettings();
    });

    it('correctly propagates changes to UserSettings.formatSettings.epub when opening an EPUB book', async () => {
      const { result: book1 } = renderHook(() => useReaderSettings(book1Id, 'epub'));
      await waitFor(() => expect(book1.current.loading).toBe(false));

      expect(book1.current.isCustomBook).toBe(false);

      await act(async () => {
        await book1.current.updateReaderSettings({
          fontSize: 22,
          readerSheetColor: 'archive',
          expandContent: true,
          readingMode: 'scroll',
        });
      });

      expect(book1.current.settings.fontSize).toBe(22);
      expect(book1.current.settings.readerSheetColor).toBe('archive');
      expect(book1.current.settings.expandContent).toBe(true);

      const savedSettings = await getSettings();
      expect(savedSettings?.formatSettings?.epub).toBeDefined();
      expect(savedSettings?.formatSettings?.epub?.fontSize).toBe(22);
      expect(savedSettings?.formatSettings?.epub?.readerSheetColor).toBe('archive');
      expect(savedSettings?.formatSettings?.epub?.expandContent).toBe(true);
      expect(savedSettings?.formatSettings?.epub?.readingMode).toBe('scroll');
    });

    it('automatically inherits format settings in another EPUB book', async () => {
      // 1. Establish universal EPUB settings through Book 1
      const { result: book1 } = renderHook(() => useReaderSettings(book1Id, 'epub'));
      await waitFor(() => expect(book1.current.loading).toBe(false));

      await act(async () => {
        await book1.current.updateReaderSettings({
          fontSize: 24,
          readerSheetColor: 'dark',
          expandContent: true,
        });
      });

      // 2. Open Book 2 (another EPUB book)
      const { result: book2 } = renderHook(() => useReaderSettings(book2Id, 'epub'));
      await waitFor(() => expect(book2.current.loading).toBe(false));

      expect(book2.current.isCustomBook).toBe(false);
      expect(book2.current.settings.fontSize).toBe(24);
      expect(book2.current.settings.readerSheetColor).toBe('dark');
      expect(book2.current.settings.expandContent).toBe(true);
    });

    it('isolates settings to that book when enabling "This Book Only"', async () => {
      const { result: book1 } = renderHook(() => useReaderSettings(book1Id, 'epub'));
      await waitFor(() => expect(book1.current.loading).toBe(false));

      // Enable "This Book Only"
      await act(async () => {
        await book1.current.setIsCustomBook(true);
      });

      expect(book1.current.isCustomBook).toBe(true);

      // Apply custom settings to Book 1
      await act(async () => {
        await book1.current.updateReaderSettings({
          fontSize: 32,
          readerSheetColor: 'dark',
          expandContent: true,
        });
      });

      expect(book1.current.settings.fontSize).toBe(32);
      expect(book1.current.settings.readerSheetColor).toBe('dark');

      // Open Book 3 — it should NOT inherit Book 1's custom settings
      const { result: book3 } = renderHook(() => useReaderSettings(book3Id, 'epub'));
      await waitFor(() => expect(book3.current.loading).toBe(false));

      expect(book3.current.isCustomBook).toBe(false);
      expect(book3.current.settings.fontSize).toBe(18); // default
      expect(book3.current.settings.readerSheetColor).toBe('paper');
      expect(book3.current.settings.expandContent).toBe(false);
    });

    it('reverts to universal EPUB format settings when disabling "This Book Only"', async () => {
      // 1. Establish universal EPUB settings (fontSize: 20, archive)
      const { result: setupHook } = renderHook(() => useReaderSettings('setup-book', 'epub'));
      await waitFor(() => expect(setupHook.current.loading).toBe(false));
      await act(async () => {
        await setupHook.current.updateReaderSettings({
          fontSize: 20,
          readerSheetColor: 'archive',
        });
      });

      // 2. Open Book 1 and customize it
      const { result: book1 } = renderHook(() => useReaderSettings(book1Id, 'epub'));
      await waitFor(() => expect(book1.current.loading).toBe(false));

      expect(book1.current.settings.fontSize).toBe(20);

      await act(async () => {
        await book1.current.setIsCustomBook(true);
      });
      await act(async () => {
        await book1.current.updateReaderSettings({
          fontSize: 34,
          readerSheetColor: 'dark',
        });
      });

      expect(book1.current.settings.fontSize).toBe(34);
      expect(book1.current.settings.readerSheetColor).toBe('dark');

      // 3. Disable "This Book Only" -> reverts back to universal EPUB settings
      await act(async () => {
        await book1.current.setIsCustomBook(false);
      });

      expect(book1.current.isCustomBook).toBe(false);
      expect(book1.current.settings.fontSize).toBe(20);
      expect(book1.current.settings.readerSheetColor).toBe('archive');
    });

    it('clears formatSettings.epub when calling resetBookSettings() in universal mode', async () => {
      const { result: book1 } = renderHook(() => useReaderSettings(book1Id, 'epub'));
      await waitFor(() => expect(book1.current.loading).toBe(false));

      // Set universal EPUB settings
      await act(async () => {
        await book1.current.updateReaderSettings({
          fontSize: 28,
          readerSheetColor: 'dark',
        });
      });

      expect(book1.current.settings.fontSize).toBe(28);

      // Reset book settings while in universal mode
      await act(async () => {
        await book1.current.resetBookSettings();
      });

      expect(book1.current.settings.fontSize).toBe(18); // Default font size
      const saved = await getSettings();
      expect(saved?.formatSettings?.epub).toBeUndefined();
    });
  });
});
