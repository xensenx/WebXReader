import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { ReaderSettings } from '../components/reader/ReaderSettings';
import { useReaderSettings } from '../hooks/useReaderSettings';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';
import {
  clearDatabase,
  saveSettings,
  saveBookSettings,
} from '../core/storage/database';
import { DEFAULT_SETTINGS } from '../types/book';

describe('Reader Settings Enhancements', () => {
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

  describe('ReaderSettings component', () => {
    it('renders Page Canvas section with 3 sheet background options and handles selection', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="txt"
        />
      );

      expect(screen.getByText('Page Canvas')).toBeInTheDocument();
      const paperBtn = screen.getByRole('button', { name: /paper white/i });
      const archiveBtn = screen.getByRole('button', { name: /archive gold/i });
      const darkBtn = screen.getByRole('button', { name: /^dark$/i });

      expect(paperBtn).toBeInTheDocument();
      expect(archiveBtn).toBeInTheDocument();
      expect(darkBtn).toBeInTheDocument();

      // Click Archive Gold
      fireEvent.click(archiveBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readerSheetColor: 'archive' });

      // Click Dark
      fireEvent.click(darkBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readerSheetColor: 'dark' });

      // Click Paper White
      fireEvent.click(paperBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readerSheetColor: 'paper' });
    });

    it('renders only Contracted Mode and Expanded Mode buttons for txt format, and neither Pages nor Double-Sided', () => {
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={vi.fn()}
          onReset={vi.fn()}
          format="txt"
        />
      );

      expect(screen.getByRole('button', { name: /contracted mode/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expanded mode/i })).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^pages$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /double sided/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /vertical scroll/i })).not.toBeInTheDocument();
    });

    it('handles clicking Contracted Mode and Expanded Mode for txt format', () => {
      const handleUpdate = vi.fn();
      const { rerender } = render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="txt"
        />
      );

      const contractedModeBtn = screen.getByRole('button', { name: /contracted mode/i });
      const expandedModeBtn = screen.getByRole('button', { name: /expanded mode/i });

      // When expandContent is false, Contracted Mode is active
      expect(contractedModeBtn.className).toMatch(/modeBtnActive/);
      expect(expandedModeBtn.className).not.toMatch(/modeBtnActive/);

      // Click Expanded Mode
      fireEvent.click(expandedModeBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ expandContent: true, readingMode: 'scroll' });

      // Rerender with expandContent: true
      rerender(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, expandContent: true }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="txt"
        />
      );

      expect(expandedModeBtn.className).toMatch(/modeBtnActive/);
      expect(contractedModeBtn.className).not.toMatch(/modeBtnActive/);

      // Click Contracted Mode
      fireEvent.click(contractedModeBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ expandContent: false, readingMode: 'scroll' });
    });

    it('does not render separate Expand to Full Width toggle switch when format is txt', () => {
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={vi.fn()}
          onReset={vi.fn()}
          format="txt"
        />
      );

      expect(screen.queryByRole('switch', { name: /expand to full width/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/^expand to full width$/i)).not.toBeInTheDocument();
    });

    it('renders original Reading Mode options and Expand to Full Width toggle for non-txt formats (e.g. epub)', () => {
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

      // Reading Mode options
      expect(screen.getByRole('button', { name: /vertical scroll/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^pages$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /double sided/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /page mode/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /expanded mode/i })).not.toBeInTheDocument();

      // Separate toggle switch
      const expandToggle = screen.getByRole('switch', { name: /expand to full width/i });
      expect(expandToggle).toBeInTheDocument();
      expect(expandToggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(expandToggle);
      expect(handleUpdate).toHaveBeenCalledWith({ expandContent: true });
    });

    it('toggles expand off when already active for non-txt reflowable format', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, expandContent: true }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="epub"
        />
      );

      const expandToggle = screen.getByRole('switch', { name: /expand to full width/i });
      expect(expandToggle).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(expandToggle);
      expect(handleUpdate).toHaveBeenCalledWith({ expandContent: false });
    });

    it('handles Font Size stepper and slider updates', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="txt"
        />
      );

      // Stepper decrease button
      const decreaseBtn = screen.getByRole('button', { name: /decrease font size/i });
      fireEvent.click(decreaseBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ fontSize: 17 });

      // Stepper increase button
      const increaseBtn = screen.getByRole('button', { name: /increase font size/i });
      fireEvent.click(increaseBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ fontSize: 19 });

      // Range slider
      const slider = screen.getByRole('slider', { name: /font size slider/i });
      expect(slider).toBeInTheDocument();
      expect(slider).toHaveAttribute('min', '12');
      expect(slider).toHaveAttribute('max', '36');
      expect(slider).toHaveAttribute('step', '1');
      expect(slider).toHaveValue('18');

      fireEvent.change(slider, { target: { value: '26' } });
      expect(handleUpdate).toHaveBeenCalledWith({ fontSize: 26 });
    });

    it('does not render Theme selection section', () => {
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={vi.fn()}
          onReset={vi.fn()}
          format="txt"
        />
      );

      expect(screen.queryByText(/^Theme$/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^sepia$/i })).not.toBeInTheDocument();
    });
  });

  describe('useReaderSettings hook with sheet color & expand', () => {
    const bookId = 'book-sheet-test-1';

    beforeEach(async () => {
      await clearDatabase();
    });

    afterEach(async () => {
      await clearDatabase();
    });

    it('defaults readerSheetColor to paper and expandContent to false from global settings', async () => {
      const { result } = renderHook(() => useReaderSettings(bookId));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.settings.readerSheetColor).toBe('paper');
      expect(result.current.settings.expandContent).toBe(false);
    });

    it('merges per-book overrides for readerSheetColor and expandContent', async () => {
      await saveBookSettings({
        bookId,
        readerSheetColor: 'dark',
        expandContent: true,
        updatedAt: Date.now(),
      });

      const { result } = renderHook(() => useReaderSettings(bookId));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.settings.readerSheetColor).toBe('dark');
      expect(result.current.settings.expandContent).toBe(true);
    });

    it('updates readerSheetColor and expandContent per-book', async () => {
      const { result } = renderHook(() => useReaderSettings(bookId));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateReaderSettings({
          readerSheetColor: 'archive',
          expandContent: true,
        });
      });

      expect(result.current.settings.readerSheetColor).toBe('archive');
      expect(result.current.settings.expandContent).toBe(true);

      // Verify reset clears overrides
      await act(async () => {
        await result.current.resetBookSettings();
      });

      expect(result.current.settings.readerSheetColor).toBe('paper');
      expect(result.current.settings.expandContent).toBe(false);
    });

    it('inherits custom global defaults when no book override is present', async () => {
      await saveSettings({
        ...DEFAULT_SETTINGS,
        readerSheetColor: 'archive',
        expandContent: true,
      });

      const { result } = renderHook(() => useReaderSettings(bookId));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.settings.readerSheetColor).toBe('archive');
      expect(result.current.settings.expandContent).toBe(true);
    });
  });
});
