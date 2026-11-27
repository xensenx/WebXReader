import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from '../app/providers/SettingsContext';
import { SidePanelProvider } from '../app/providers/SidePanelContext';
import { PlannedFeaturePage } from '../components/common/PlannedFeaturePage';
import { LibraryView } from '../components/library/LibraryView';
import { ReaderView } from '../components/reader/ReaderView';
import { SeriesView } from '../components/series/SeriesView';
import { InformationPage } from '../components/settings/InformationPage';
import { SettingsView } from '../components/settings/SettingsView';
import {
  addBook, addBooksToSeries, clearDatabase, clearSettings, deleteBook, deleteSeries, exportBackup, exportBackupStream,
  getBook, getSeriesForBook, listSeries, reorderBooksInSeries, restoreBackup, saveBookContent, saveProgress, saveSeries,
} from '../core/storage/database';
import { invalidateBooksCache } from '../hooks/useBooks';
import type { Book, ReadingProgress } from '../types/book';
import * as coverImageTools from '../utils/cover-image';

function book(id: string, title: string, readingStatus: Book['readingStatus'] = 'unread'): Book {
  return {
    id, title, author: 'Example Author', description: '', language: '', publisher: '', publicationDate: '',
    identifiers: {}, sourceFormat: 'txt', originalFilename: `${id}.txt`, fileSize: 300, contentHash: `hash-${id}`,
    importedAt: 1000, updatedAt: 1000, userTags: [], userRating: null, favorite: false, archived: false,
    readingStatus, lastOpenedAt: null, tableOfContents: [], totalChapters: 1,
  };
}

function progress(bookId: string, overallProgress: number): ReadingProgress {
  return { bookId, overallProgress, chapterId: 'chapter-1', chapterProgress: 0, pageIndex: 0, scrollPosition: 0,
    readingMode: 'scroll', lastUpdatedAt: 1 };
}

function renderLibrary(pathname: string) {
  return render(
    <SettingsProvider>
      <MemoryRouter initialEntries={[pathname]}>
        <SidePanelProvider>
          <Routes>
            <Route path="/" element={<LibraryView />} />
            <Route path="/series" element={<SeriesView />} />
            <Route path="/series/:seriesId" element={<SeriesView />} />
            <Route path="/read/:bookId" element={<ReaderView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/about" element={<InformationPage kind="about" />} />
            <Route path="/privacy-policy" element={<InformationPage kind="privacy" />} />
            <Route path="/terms-of-use" element={<InformationPage kind="terms" />} />
            <Route path="/stats" element={<PlannedFeaturePage title="Stats" />} />
            <Route path="/private-mode" element={<PlannedFeaturePage title="Private mode" />} />
          </Routes>
        </SidePanelProvider>
      </MemoryRouter>
    </SettingsProvider>,
  );
}

function openMenuPage(name: string) {
  if (!screen.queryByRole('dialog', { name: 'Menu' })) fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = within(screen.getByRole('dialog', { name: 'Menu' }));
  fireEvent.click(menu.queryByRole('link', { name }) ?? menu.getByRole('button', { name }));
}

describe('Series', () => {
  beforeEach(async () => {
    await clearDatabase();
    await clearSettings();
    localStorage.removeItem('webxreader.series-browser.v1');
    localStorage.removeItem('webxreader.series-volume-layout');
    invalidateBooksCache();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('saves numbered order, preserves exclusivity, and drops deleted books', async () => {
    await addBook(book('a', 'Book A'));
    await addBook(book('b', 'Book B'));
    const series = await saveSeries({ id: 's', title: 'Example Series', bookIds: ['a', 'b'], volumeNumbers: { a: 2, b: 1.5 } });
    expect(series.bookIds).toEqual(['b', 'a']);
    expect(await getSeriesForBook('a')).toEqual(series);
    await expect(saveSeries({ id: 'other', title: 'Another Series', bookIds: ['a'] })).rejects.toThrow(/another series/i);
    await expect(saveSeries({ ...series, volumeNumbers: { a: 1, b: 1 } })).rejects.toThrow(/different number/i);
    await deleteBook('b');
    expect(await listSeries()).toEqual([{ ...series, bookIds: ['a'], volumeNumbers: { a: 2 } }]);
    await deleteSeries('s');
    expect(await getSeriesForBook('a')).toBeUndefined();
    expect(await getBook('a')).toBeDefined();
  });

  it('round-trips ordered series in both backup paths and matches content already in the library', async () => {
    await addBook(book('a', 'Book A'));
    await addBook(book('b', 'Book B'));
    const series = await saveSeries({
      id: 's', title: 'Backup Series', bookIds: ['b', 'a'], author: 'Series Author', tags: ['Fantasy'],
      description: 'Backup synopsis', coverImage: 'data:image/webp;base64,Y292ZXI=',
    });
    const backup = await exportBackup();
    expect(backup.series).toEqual([series]);
    const streamed = await new Response(await exportBackupStream()).json();
    expect(streamed.series).toEqual([series]);
    await clearDatabase();
    await addBook({ ...book('a', 'Book A'), id: 'existing-a' });
    const result = await restoreBackup(streamed);
    expect(result.booksRestored).toBe(1);
    expect(await listSeries()).toEqual([{ ...series, bookIds: ['b', 'existing-a'], volumeNumbers: undefined }]);
  });

  it.each(['grid', 'list'])('adds a book from the %s menu using an existing series', async (layout) => {
    await addBook(book('a', 'Book A'));
    await saveSeries({ id: 'first', title: 'First Series', bookIds: [] });
    await saveSeries({ id: 'second', title: 'Second Series', bookIds: [] });
    renderLibrary('/');
    await screen.findByRole('button', { name: 'Actions for Book A' });
    if (layout === 'list') {
      const listMode = screen.getByRole('button', { name: 'List view' });
      fireEvent.click(listMode);
      await waitFor(() => expect(listMode).toHaveAttribute('aria-pressed', 'true'));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Book A' }));
    const menu = within(screen.getByRole('menu'));
    expect(menu.getAllByRole('menuitem')[0]).toHaveTextContent('Add to series');
    expect(menu.queryByRole('menuitem', { name: 'Read' })).toBeNull();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Add to series' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add to series' }));
    expect(await dialog.findAllByRole('radio')).toHaveLength(2);
    fireEvent.click(dialog.getByRole('radio', { name: /Second Series/i }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add to series' }));
    await screen.findByText('Added to Second Series.');
    expect(await getSeriesForBook('a')).toMatchObject({ id: 'second', bookIds: ['a'] });
  });

  it('opens the editor with the selected book when other series exist', async () => {
    await addBook(book('a', 'Book A'));
    await saveSeries({ id: 'existing', title: 'Existing Series', bookIds: [] });
    renderLibrary('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Book A' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Add to series' }));
    const picker = within(await screen.findByRole('dialog', { name: 'Add to series' }));
    fireEvent.click(await picker.findByRole('radio', { name: /Existing Series/ }));
    expect(picker.getByRole('button', { name: 'Add to series' })).toBeEnabled();
    fireEvent.click(picker.getByRole('button', { name: 'Create series' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Create series' }));
    expect(editor.getByText('1 selected')).toBeInTheDocument();
    expect(editor.getByLabelText('Series name')).toHaveValue('Book A');
    expect(editor.getByLabelText('Author')).toHaveValue('Example Author');
    fireEvent.click(editor.getByRole('button', { name: 'Select' }));
    const selected = within(screen.getByRole('dialog', { name: 'Select books' })).getByRole('checkbox', { name: /Book A/ });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    expect(selected).toHaveAttribute('aria-description', 'Selection position 1');
  });

  it.each([false, true])('appends a bulk selection in click order with numbered order %s', async (numbered) => {
    await Promise.all([addBook(book('a', 'Book A')), addBook(book('b', 'Book B')), addBook(book('c', 'Book C'))]);
    const series = await saveSeries({ id: 's', title: 'Reading Order', bookIds: ['b'], volumeNumbers: numbered ? { b: 2.5 } : undefined });
    renderLibrary('/');
    await screen.findByRole('button', { name: 'Actions for Book A' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Book C by/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Book A by/i }));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selected book actions' })).getByRole('button', { name: 'Add to series' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add to series' }));
    fireEvent.click(await dialog.findByRole('radio', { name: /Reading Order/i }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add to series' }));
    await screen.findByText('Added to Reading Order.');
    expect(await getSeriesForBook('a')).toEqual({ ...series, bookIds: ['b', 'c', 'a'],
      ...(numbered && { volumeNumbers: { b: 2.5, c: 3.5, a: 4.5 } }) });
  });

  it('keeps simultaneous additions and rolls back a conflicting batch', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await addBook(book(id, id));
    await saveSeries({ id: 's', title: 'Target Series', bookIds: [] });
    await saveSeries({ id: 'other', title: 'Other Series', bookIds: ['c'] });
    await Promise.all([addBooksToSeries('s', ['b']), addBooksToSeries('s', ['a', 'b'])]);
    await expect(addBooksToSeries('s', ['d', 'c'])).rejects.toThrow(/another series/i);
    expect(await getSeriesForBook('a')).toMatchObject({ bookIds: ['b', 'a'] });
    expect(await getSeriesForBook('d')).toBeUndefined();
  });

  it.each([false, true])('reorders volumes by dragging and preserves assigned numbers when present (%s)', async (numbered) => {
    await addBook(book('a', 'Book A'));
    await addBook({ ...book('b', 'Book B'), originalFilename: 'Reorder Series - Vol. 0.25.txt' });
    await saveSeries({ id: 's', title: 'Reorder Series', author: 'Series Author', bookIds: ['a', 'b'],
      volumeNumbers: numbered ? { a: 0.5, b: 3 } : undefined });
    renderLibrary('/series/s');
    await screen.findByRole('heading', { name: 'Reorder Series' });
    const volumes = within(screen.getByRole('region', { name: 'Volumes' }));
    const list = volumes.getByRole('button', { name: 'List view' });
    fireEvent.click(list);
    expect(list).toHaveAttribute('aria-pressed', 'true');
    const feed = volumes.getByRole('feed', { name: 'Series volumes' });
    const a = within(feed).getByRole('button', { name: /Book A/ });
    const b = within(feed).getByRole('button', { name: 'Book B by Example Author' });
    vi.spyOn(feed, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 160));
    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 80));
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 180, 300, 80));
    Object.assign(b, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 140 };
    fireEvent.pointerDown(b, { ...pointer, clientY: 220 });
    fireEvent.pointerMove(b, { ...pointer, clientY: 110 });
    fireEvent.pointerUp(b, { ...pointer, clientY: 110 });

    await waitFor(async () => expect(await getSeriesForBook('b')).toMatchObject({
      author: 'Series Author', bookIds: ['b', 'a'], ...(numbered && { volumeOrder: 'custom', volumeNumbers: { a: 0.5, b: 3 } }),
    }));
    expect(within(feed).getAllByRole('button').map((item) => item.dataset.bookId)).toEqual(['b', 'a']);
    expect(within(feed).getAllByRole('button')[0]).toHaveTextContent(numbered ? 'Volume 3' : 'Volume 0.25');
    expect(volumes.queryByRole('button', { name: 'Save order' })).toBeNull();
    expect(volumes.queryByRole('button', { name: /Actions for/i })).toBeNull();
    const grid = volumes.getByRole('button', { name: 'Grid view' });
    fireEvent.click(grid);
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    expect(within(feed).getAllByRole('button').map((item) => item.dataset.bookId)).toEqual(['b', 'a']);
    if (numbered) {
      fireEvent.click(volumes.getByRole('button', { name: 'Sort by volume number' }));
      await volumes.findByText('Volumes sorted by number.');
      expect(await getSeriesForBook('b')).toMatchObject({ bookIds: ['a', 'b'], volumeNumbers: { a: 0.5, b: 3 } });
    }
  });

  it('commits the displayed drop slot when releasing in a two column grid', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await addBook(book(id, `Book ${id.toUpperCase()}`));
    await saveSeries({ id: 's', title: 'Grid Series', bookIds: ['a', 'b', 'c', 'd'] });
    renderLibrary('/series/s');
    const feed = await screen.findByRole('feed', { name: 'Series volumes' });
    feed.style.gridTemplateColumns = '100px 100px';
    vi.spyOn(feed, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 210, 170));
    const cards = within(feed).getAllByRole('button');
    const displayedOrder = () => within(feed).getAllByRole('button').map((card) => card.dataset.bookId);
    for (const card of cards) {
      Object.assign(card, { animate: () => ({ cancel: vi.fn() }) });
      vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => {
        const index = displayedOrder().indexOf(card.dataset.bookId);
        return new DOMRect((index % 2) * 110, 100 + Math.floor(index / 2) * 90, 100, 80);
      });
    }
    const source = cards[0];
    Object.assign(source, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });

    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, clientY: 125 };
    fireEvent.pointerDown(source, { ...pointer, clientX: 50 });
    fireEvent.pointerMove(source, { ...pointer, clientX: 195 });
    expect(displayedOrder()).toEqual(['b', 'a', 'c', 'd']);
    fireEvent.pointerUp(source, { ...pointer, clientX: 195 });
    const edit = screen.getByRole('button', { name: 'Edit series' });
    expect(edit).toBeDisabled();
    fireEvent.click(source);
    expect(screen.getByRole('heading', { name: 'Grid Series' })).toBeInTheDocument();
    await waitFor(() => expect(edit).toBeEnabled());
    expect(await getSeriesForBook('a')).toMatchObject({ bookIds: ['b', 'a', 'c', 'd'] });
  });

  it('lets the next click open a volume after blur cancels a touch drag', async () => {
    await addBook(book('a', 'Book A'));
    await addBook(book('b', 'Book B'));
    await saveSeries({ id: 's', title: 'Touch Series', bookIds: ['a', 'b'] });
    renderLibrary('/series/s');
    const source = await screen.findByRole('button', { name: /Book A/ });
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(source, { pointerId: 1, pointerType: 'touch', button: 0 });
      act(() => vi.advanceTimersByTime(180));
      fireEvent.blur(window);
      fireEvent.click(source);
    } finally {
      vi.useRealTimers();
    }
    expect(screen.queryByRole('heading', { name: 'Touch Series' })).not.toBeInTheDocument();
  });

  it('keeps new volumes when saving a stale reorder', async () => {
    for (const id of ['a', 'b', 'c']) await addBook(book(id, id));
    await saveSeries({ id: 's', title: 'Series', bookIds: ['a', 'b'] });
    await addBooksToSeries('s', ['c']);
    await expect(reorderBooksInSeries('s', ['b', 'a'])).rejects.toThrow(/volumes.*changed/i);
    expect(await getSeriesForBook('a')).toMatchObject({ bookIds: ['a', 'b', 'c'] });
  });

  it('returns from Settings to the same series detail after changing the Settings section', async () => {
    await saveSeries({ id: 'nav-series', title: 'Original Series', bookIds: [] });
    renderLibrary('/series/nav-series');
    await screen.findByRole('heading', { name: 'Original Series' });
    openMenuPage('Settings');
    fireEvent.click(await screen.findByRole('tab', { name: 'Reading options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Series' }));
    expect(await screen.findByRole('heading', { name: 'Original Series' })).toBeInTheDocument();
    openMenuPage('About');
    expect(await screen.findByRole('heading', { name: 'About WebXReader' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Series' }));
    expect(await screen.findByRole('heading', { name: 'Original Series' })).toBeInTheDocument();
  });

  it.each(['Stats', 'Private mode'])('treats %s as a main page and returns to it from a secondary page', async (tab) => {
    renderLibrary('/series');
    openMenuPage(tab);
    const heading = `${tab} is coming in a future update`;
    await screen.findByRole('heading', { name: heading });
    openMenuPage('Privacy Policy');
    fireEvent.click(await screen.findByRole('button', { name: `Back to ${tab}` }));
    await screen.findByRole('heading', { name: heading });
    expect(screen.queryByRole('button', { name: /^Back to/ })).toBeNull();
    openMenuPage('Series');
    expect(await screen.findByRole('heading', { name: 'Series' })).toBeInTheDocument();
  });

  it('opens Terms of Use below Privacy Policy and returns to the originating page', async () => {
    renderLibrary('/stats');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = within(screen.getByRole('dialog', { name: 'Menu' }));
    const labels = menu.getAllByRole('link').map((link) => link.textContent?.trim());
    expect(labels[labels.indexOf('Privacy Policy') + 1]).toBe('Terms of Use');
    fireEvent.click(menu.getByRole('link', { name: 'Terms of Use' }));

    expect(screen.getByRole('heading', { name: 'Terms of Use', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('November 28, 2026')).toHaveAttribute('datetime', '2026-11-28');
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(20);
    fireEvent.click(screen.getByRole('link', { name: 'Privacy Policy' }));
    expect(screen.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Terms of Use' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Stats' }));
    expect(screen.getByRole('heading', { name: 'Stats is coming in a future update' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
  });

  it('selects books first, suggests editable details, and preserves click order and progress', async () => {
    const filename = 'The Collector’s Complete Illustrated Saga - Volume 07.5.txt';
    await addBook({ ...book('a', 'Book A', 'completed'), originalFilename: filename,
      author: 'Unknown Author', userTags: ['fantasy', 'Illustrated'] });
    await addBook({ ...book('b', 'Book B'), originalFilename: 'The Collector’s Complete Illustrated Saga - Vol. 10.txt',
      userTags: ['Adventure', 'Fantasy'] });
    await saveProgress(progress('b', 0.5));
    renderLibrary('/series');
    const create = await screen.findByRole('button', { name: 'Create series' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    const dialog = within(screen.getByRole('dialog', { name: 'Create series' }));
    expect(dialog.queryByLabelText('Series name')).toBeNull();
    expect(dialog.queryByLabelText('Author')).toBeNull();
    expect(dialog.getByText(/order you select them/i)).toBeInTheDocument();
    const select = dialog.getByRole('button', { name: 'Select' });
    expect(select.querySelector('svg')).toBeNull();
    fireEvent.click(select);
    const pickerDialog = screen.getByRole('dialog', { name: 'Select books' });
    const picker = within(pickerDialog);
    expect(picker.getByRole('button', { name: 'Use selected books' })).toBeDisabled();
    const search = picker.getByRole('textbox', { name: 'Search title or filename' });
    fireEvent.click(picker.getByRole('checkbox', { name: /Book B/ }));
    fireEvent.change(search, { target: { value: '07.5' } });
    await waitFor(() => expect(picker.queryByRole('checkbox', { name: /Book B/ })).toBeNull());
    expect(picker.getByText(filename)).toBeInTheDocument();
    const volumeName = `Book A by Unknown Author, ${filename}`;
    const volume = picker.getByRole('checkbox', { name: volumeName });
    fireEvent.click(volume);
    expect(volume).toHaveAttribute('aria-description', 'Selection position 2');
    fireEvent.click(picker.getByRole('button', { name: 'List view' }));
    expect(picker.getByRole('checkbox', { name: volumeName })).toHaveAttribute('aria-description', 'Selection position 2');
    fireEvent.click(picker.getByRole('button', { name: 'Use selected books' }));
    const name = dialog.getByLabelText('Series name');
    expect(name).toHaveValue('The Collector’s Complete Illustrated Saga');
    expect(name).toHaveFocus();
    expect(dialog.getByLabelText('Author')).toHaveValue('Example Author');
    expect(dialog.getByLabelText('Tags (comma separated)')).toHaveValue('Adventure, Fantasy, Illustrated');
    fireEvent.change(name, { target: { value: 'Custom Series' } });
    fireEvent.change(dialog.getByLabelText('Author'), { target: { value: 'Custom Author' } });
    fireEvent.change(dialog.getByLabelText('Tags (comma separated)'), { target: { value: 'Personal' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Select' }));
    fireEvent.click(picker.getByRole('checkbox', { name: /Book B/ }));
    fireEvent.keyDown(pickerDialog, { key: 'Escape' });
    expect(dialog.getByText('2 selected')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Select' })).toHaveFocus();
    expect(dialog.getByLabelText('Series name')).toHaveValue('Custom Series');
    fireEvent.click(dialog.getByRole('button', { name: 'Create series' }));
    const card = await screen.findByRole('link', { name: /Custom Series/ });
    expect(await getSeriesForBook('a')).toMatchObject({ title: 'Custom Series', author: 'Custom Author', tags: ['Personal'] });
    expect(within(card).getByText('75%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Book [AB]/ })).toBeNull();
    fireEvent.click(card);
    expect(await screen.findByText('1 of 2 volumes completed')).toBeInTheDocument();
    const volumes = within(screen.getByRole('region', { name: 'Volumes' }));
    expect(within(volumes.getByRole('feed')).getAllByRole('button').map((item) => item.dataset.bookId)).toEqual(['b', 'a']);
    expect(volumes.getByText('50%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'All series' }));
    expect(await screen.findByRole('link', { name: /Custom Series/ })).toBeInTheDocument();
  });

  it('saves numeric sorting for decimal filenames and titles, with unnumbered entries last', async () => {
    const books = [
      book('extra', 'Companion'),
      { ...book('ten', 'The Saga'), originalFilename: 'The Saga - Vol 10.cbz' },
      { ...book('half', 'The Saga'), originalFilename: 'The Saga - Vol. 07.5.cbz' },
      { ...book('small', 'The Saga'), originalFilename: 'The Saga - Vol 7.12.cbz' },
      book('seven', 'The Saga Volume 7'),
      { ...book('issue', 'The Saga'), originalFilename: 'The Saga #7.5.cbz' },
    ];
    await Promise.all(books.map(addBook));
    await saveSeries({ id: 'numeric', title: 'Numeric Order', bookIds: books.map(({ id }) => id) });
    renderLibrary('/series/numeric');
    const feed = await screen.findByRole('feed', { name: 'Series volumes' });
    const order = () => within(feed).getAllByRole('button').map((item) => item.dataset.bookId);
    expect(order()).toEqual(books.map(({ id }) => id));
    fireEvent.click(screen.getByRole('button', { name: 'Sort by volume number' }));
    await screen.findByText('Volumes sorted by number.');
    const sortedIds = ['seven', 'small', 'half', 'issue', 'ten', 'extra'];
    expect(order()).toEqual(sortedIds);
    expect(await getSeriesForBook('extra')).toMatchObject({ bookIds: sortedIds });
    expect(feed.querySelector('[data-book-id="half"]')).toHaveTextContent('Volume 7.5');
  });

  it('shows compact series cards and uses the first volume cover for the banner until a custom cover is saved', async () => {
    const firstCover = 'data:image/png;base64,aW5pdGlhbA==';
    const customCover = 'data:image/webp;base64,Y3VzdG9t';
    await addBook({ ...book('a', 'Book A'), coverImage: firstCover });
    await addBook(book('b', 'Book B'));
    await saveSeries({ id: 's', title: 'A Long Series', bookIds: ['a', 'b'] });
    await saveSeries({ id: 'other', title: 'Another Series', bookIds: [] });
    renderLibrary('/series');
    const card = await screen.findByRole('link', { name: /A Long Series/ });
    expect(await screen.findByRole('link', { name: /Another Series/ })).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', firstCover);
    expect(screen.queryByRole('region', { name: 'Volumes' })).toBeNull();
    fireEvent.click(card);
    const title = await screen.findByRole('heading', { level: 1, name: 'A Long Series' });
    const hero = title.closest('header')!;
    expect(Array.from(hero.querySelectorAll('img'), (image) => image.getAttribute('src'))).toEqual([firstCover, firstCover]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit series' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit series' }));
    fireEvent.change(dialog.getByLabelText('Author'), { target: { value: 'Series Author' } });
    fireEvent.change(dialog.getByLabelText('Synopsis'), { target: { value: 'A series synopsis.' } });
    fireEvent.change(dialog.getByLabelText('Tags (comma separated)'), { target: { value: 'Fantasy, Adventure' } });
    const prepare = vi.spyOn(coverImageTools, 'prepareCoverFile').mockResolvedValueOnce({
      data: customCover, width: 100, height: 150, isRemote: false,
    });
    try {
      const file = new File(['cover'], 'custom.png', { type: 'image/png' });
      fireEvent.change(dialog.getByLabelText('Choose a series cover image from your device'), { target: { files: [file] } });
      await dialog.findByText('Custom cover');
      expect(prepare).toHaveBeenCalledWith(file);
      fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    } finally {
      prepare.mockRestore();
    }
    expect(await within(hero).findByText('A series synopsis.')).toBeInTheDocument();
    expect(within(hero).getByText('Series Author')).toBeInTheDocument();
    expect(within(hero).getByText('Fantasy')).toBeInTheDocument();
    expect(Array.from(hero.querySelectorAll('img'), (image) => image.getAttribute('src'))).toEqual([customCover, customCover]);
    expect((await exportBackup()).series).toContainEqual(expect.objectContaining({ id: 's', coverImage: customCover, author: 'Series Author' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit series' }));
    const reopen = within(screen.getByRole('dialog', { name: 'Edit series' }));
    fireEvent.click(reopen.getByRole('button', { name: 'Use first volume cover' }));
    fireEvent.click(reopen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(hero.querySelector('img')).toHaveAttribute('src', firstCover));
  });

  it('searches by volume title, filters series progress, and remembers custom ordering', async () => {
    await addBook(book('a', 'The Hidden Chapter', 'completed'));
    await addBook(book('b', 'Book B'));
    await saveSeries({ id: 'one', title: 'Alpha Series', bookIds: ['a'] });
    await saveSeries({ id: 'two', title: 'Beta Series', bookIds: ['b'] });
    renderLibrary('/series');
    await screen.findByRole('link', { name: /Alpha Series/ });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search series' }), { target: { value: 'hidden chapter' } });
    await waitFor(() => expect(screen.queryByRole('link', { name: /Beta Series/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Alpha Series/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Unread' }));
    expect(screen.queryByRole('link', { name: /Alpha Series/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Beta Series/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Beta Series up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done reordering' }));
    const rowOrder = () => screen.getAllByRole('article').map((row) => within(row).getByRole('heading').textContent);
    expect(rowOrder()).toEqual(['Beta Series', 'Alpha Series']);
    fireEvent.click(screen.getByRole('link', { name: /Beta Series/ }));
    fireEvent.click(await screen.findByRole('link', { name: 'All series' }));
    await waitFor(() => expect(rowOrder()).toEqual(['Beta Series', 'Alpha Series']));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse custom order' }));
    expect(rowOrder()).toEqual(['Alpha Series', 'Beta Series']);
  });

  it('shows the full alphabet even when every series has the same title initial', async () => {
    await saveSeries({ id: 'only', title: 'Only One Series', bookIds: [] });
    renderLibrary('/series');
    await screen.findByRole('link', { name: /Only One Series/ });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const initials = within(screen.getByRole('group', { name: 'Title starts with' }));
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(initials.getByRole('radio', { name: letter })).toBeEnabled();
    }
    expect(initials.getByRole('radio', { name: 'Numbers and symbols' })).toBeEnabled();
    fireEvent.click(initials.getByRole('radio', { name: 'Z' }));
    expect(screen.queryByRole('link', { name: /Only One Series/ })).toBeNull();
    fireEvent.click(initials.getByRole('radio', { name: 'O' }));
    expect(screen.getByRole('link', { name: /Only One Series/ })).toBeInTheDocument();
  });

  it('restores the position of each series independently after leaving to read', async () => {
    await addBook(book('a', 'Book A'));
    await saveBookContent({ bookId: 'a', format: 'txt', chapters: [{
      id: 'chapter', title: 'Chapter', content: '<p>A sample volume.</p>', level: 0, order: 0,
    }] });
    await saveSeries({ id: 'position-one', title: 'Position One', bookIds: ['a'] });
    await saveSeries({ id: 'position-two', title: 'Position Two', bookIds: [] });
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
    try {
      renderLibrary('/series/position-one');
      const volume = await screen.findByRole('button', { name: /Book A/ });
      scrollY.mockReturnValue(1840);
      fireEvent.click(volume);
      await screen.findByText('A sample volume.');
      scrollY.mockReturnValue(0);
      const scrollTo = vi.mocked(window.scrollTo);
      scrollTo.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Return to series' }));
      await screen.findByRole('heading', { name: 'Position One' });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1840, behavior: 'instant' });

      // Emulate the visual scroll resulting from restoration before leaving for a different series.
      scrollY.mockReturnValue(1840);
      fireEvent.click(screen.getByRole('link', { name: 'All series' }));
      scrollY.mockReturnValue(0);
      fireEvent.click(await screen.findByRole('link', { name: /Position Two/ }));
      await screen.findByRole('heading', { name: 'Position Two' });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    } finally {
      scrollY.mockRestore();
    }
  });

  it('updates completed volume progress after rewinding and recommends the next book at the end', async () => {
    for (const [id, title] of [['a', 'Book A'], ['b', 'Book B']]) {
      await addBook(book(id, title));
      await saveBookContent({ bookId: id, format: 'txt', chapters: [{ id: 'chapter-1', title: 'Chapter', content: '<p>Story text</p>', level: 0, order: 0 }] });
    }
    await saveSeries({ id: 's', title: 'Reading Series', bookIds: ['a', 'b'] });
    await saveProgress(progress('a', 0.98));
    const { container } = renderLibrary('/read/a');
    await screen.findByText('Story text');
    await screen.findByRole('link', { name: '50% of series' });

    const viewport = container.querySelector<HTMLElement>('[data-reader-viewport="vertical-scroll"]')!;
    Object.defineProperties(viewport, { scrollHeight: { value: 1100 }, clientHeight: { value: 100 } });
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    viewport.scrollTop = 979;
    fireEvent.scroll(viewport);
    await screen.findByRole('link', { name: '49% of series' });
    expect(screen.queryByRole('complementary', { name: 'Next in series' })).not.toBeInTheDocument();

    viewport.scrollTop = 980;
    fireEvent.scroll(viewport);
    const recommendation = within(await screen.findByRole('complementary', { name: 'Next in series' }));
    expect(recommendation.getByText('Book B')).toBeInTheDocument();
    fireEvent.click(recommendation.getByRole('link', { name: 'Open next' }));
    await waitFor(() => {
      expect(screen.getByText('Book B')).toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: 'Next in series' })).not.toBeInTheDocument();
    });
  });
});
