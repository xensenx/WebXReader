import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { TERMS_VERSION, type TermsAcceptance } from '../app/legal';
import * as database from '../core/storage/database';
import { invalidateBooksCache } from '../hooks/useBooks';
import { APP_THEME_OPTIONS, DEFAULT_SETTINGS, type Book } from '../types/book';

const welcomeTitle = 'Welcome to WebXReader!';
const acceptanceLabel = 'I agree to the Terms of Use and acknowledge the Privacy Policy.';
const currentAcceptance = { accepted: true, termsVersion: TERMS_VERSION, acceptedAt: 42 };

const agreement = () => screen.getByRole('checkbox', { name: acceptanceLabel });
const continueButton = () => screen.getByRole('button', { name: 'Continue to my library' });
const welcomeDialog = () => screen.getByRole('dialog', { name: welcomeTitle });

function openApp(path = '/') {
  window.history.replaceState(null, '', `/#${path}`);
  return render(<App />);
}

describe('Welcome and local terms acceptance', () => {
  beforeAll(() => {
    // jsdom does not implement native modal dialogs.
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
    });
  });

  beforeEach(async () => {
    await database.clearDatabase();
    await database.clearSettings();
    invalidateBooksCache();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    delete document.documentElement.dataset.theme;
  });

  it('resolves acceptance before showing the locked library and supports native keyboard toggling', async () => {
    let resolve!: (record: TermsAcceptance | undefined) => void;
    vi.spyOn(database, 'getTermsAcceptance').mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    let resolveBooks!: (books: Book[]) => void;
    const listBooks = vi.spyOn(database, 'listBooks').mockReturnValueOnce(new Promise((done) => { resolveBooks = done; }));
    const user = userEvent.setup();
    openApp();

    expect(screen.getByRole('status')).toHaveTextContent('Loading WebXReader');
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    expect(listBooks).not.toHaveBeenCalled();
    await act(async () => resolve(undefined));
    await waitFor(() => expect(listBooks).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: welcomeTitle })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    await act(async () => resolveBooks([]));
    const library = screen.getByText('Your Library is Empty');
    expect(library.closest('[inert]')).toHaveAttribute('aria-hidden', 'true');
    const title = await screen.findByRole('heading', { name: welcomeTitle });
    expect(title).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Your library belongs to you.' })).toBeInTheDocument();
    expect(welcomeDialog()).toHaveAttribute('aria-modal', 'true');
    expect(welcomeDialog()).toHaveAttribute('closedby', 'none');
    expect(fireEvent.keyDown(title, { key: 'Escape' })).toBe(false);
    expect(agreement()).not.toBeChecked();
    expect(continueButton()).toBeDisabled();

    await user.tab();
    expect(agreement()).toHaveFocus();
    await user.keyboard(' ');
    expect(agreement()).toBeChecked();
    expect(continueButton()).toBeEnabled();
    expect(await database.getTermsAcceptance()).toBeUndefined();
    await user.keyboard(' ');
    expect(continueButton()).toBeDisabled();
  });

  it('opens both legal documents and restores the checkbox and link focus on return', async () => {
    const user = userEvent.setup();
    openApp();
    await screen.findByRole('heading', { name: welcomeTitle });
    await user.click(screen.getByRole('link', { name: 'Terms of Use' }));
    expect(await screen.findByRole('heading', { name: 'Terms of Use', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to Welcome' }));
    await screen.findByRole('dialog', { name: welcomeTitle });
    expect(agreement()).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveFocus();

    await user.click(agreement());
    welcomeDialog().scrollTop = 48;
    await user.click(screen.getByRole('link', { name: 'Privacy Policy' }));
    expect(await screen.findByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeInTheDocument();
    act(() => window.history.back());
    await screen.findByRole('heading', { name: welcomeTitle });
    expect(agreement()).toBeChecked();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveFocus();
    expect(welcomeDialog().scrollTop).toBe(48);
    act(() => window.history.forward());
    await screen.findByRole('heading', { name: 'Privacy Policy', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Back to Welcome' }));
    await screen.findByRole('dialog', { name: welcomeTitle });
    expect(continueButton()).toBeEnabled();
    expect(await database.getTermsAcceptance()).toBeUndefined();
  });

  it.each([
    ['/terms-of-use', 'Terms of Use'], ['/privacy-policy', 'Privacy Policy'],
  ])('allows a direct visit to %s before acceptance', async (path, title) => {
    const user = userEvent.setup();
    openApp(path);
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to Welcome' }));
    expect(await screen.findByRole('heading', { name: welcomeTitle })).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it.each(['/read/existing', '/series/existing', '/settings', '/stats', '/missing'])('requires acceptance for %s', async (path) => {
    openApp(path);
    await screen.findByRole('heading', { name: welcomeTitle });
    expect(window.location.hash).toBe('#/welcome');
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
  });

  it('requires renewed acceptance for a different legal document version', async () => {
    await database.saveTermsAcceptance({ ...currentAcceptance, termsVersion: '2026-01-01.1' });
    openApp();
    await screen.findByRole('heading', { name: welcomeTitle });
    expect(agreement()).not.toBeChecked();
    expect(continueButton()).toBeDisabled();
    expect((await database.getTermsAcceptance())?.termsVersion).toBe('2026-01-01.1');
  });

  it('saves on Continue, keeps existing books, and reloads normally after preference changes', async () => {
    const existing: Book = {
      id: 'existing-welcome-book', title: 'Existing library book', author: 'Example Author', description: '',
      language: '', publisher: '', publicationDate: '', identifiers: {}, sourceFormat: 'txt', originalFilename: 'existing.txt',
      fileSize: 5, contentHash: 'existing-welcome-hash', importedAt: 1, updatedAt: 1, userTags: [], userRating: null,
      favorite: false, archived: false, readingStatus: 'unread', lastOpenedAt: null, tableOfContents: [], totalChapters: 1,
    };
    await database.addBook(existing);
    const user = userEvent.setup();
    const app = openApp();
    await screen.findByRole('heading', { name: welcomeTitle });
    const bookInLibrary = await screen.findByText(existing.title, {}, { timeout: 5000 });
    expect(bookInLibrary.closest('[inert]')).toHaveAttribute('aria-hidden', 'true');
    expect(await database.getBook(existing.id)).toEqual(existing);
    await user.click(agreement());
    expect(await database.getTermsAcceptance()).toBeUndefined();
    await user.click(continueButton());
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    expect(screen.getByText(existing.title)).toBe(bookInLibrary);
    expect(bookInLibrary.closest('[inert]')).toBeNull();
    expect(screen.queryByRole('dialog', { name: welcomeTitle })).toBeNull();
    const accepted = await database.getTermsAcceptance();
    expect(accepted).toEqual({ accepted: true, termsVersion: TERMS_VERSION, acceptedAt: expect.any(Number) });
    expect(accepted!.acceptedAt).toBeGreaterThan(0);
    expect(await database.getBook(existing.id)).toEqual(existing);
    expect(JSON.stringify(await database.exportBackup())).not.toContain(TERMS_VERSION);

    app.unmount();
    await database.saveSettings({ ...DEFAULT_SETTINGS, updatedAt: Date.now(), theme: 'sepia' });
    openApp('/stats');
    await screen.findByRole('heading', { name: 'Stats is coming in a future update' });
    expect(screen.queryByRole('heading', { name: welcomeTitle })).toBeNull();
    expect(await database.getTermsAcceptance()).toEqual(accepted);
  });

  it('stays on Welcome after a failed write and accepts a retry', async () => {
    const save = vi.spyOn(database, 'saveTermsAcceptance').mockRejectedValueOnce(new Error('Quota exceeded'));
    const user = userEvent.setup();
    openApp();
    await screen.findByRole('heading', { name: welcomeTitle });
    await user.click(agreement());
    await user.click(continueButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t save your acceptance');
    expect(save).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/welcome');
    expect(agreement()).toBeChecked();
    expect(continueButton()).toBeEnabled();
    expect(await database.getTermsAcceptance()).toBeUndefined();

    await user.click(continueButton());
    await screen.findByRole('button', { name: 'Open menu' });
    expect((await database.getTermsAcceptance())?.termsVersion).toBe(TERMS_VERSION);
  });

  it('offers a retry when the initial storage read fails', async () => {
    vi.spyOn(database, 'getTermsAcceptance').mockRejectedValueOnce(new Error('Storage blocked'));
    openApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t read your acceptance');
    expect(continueButton()).toBeDisabled();
  });

  it.each(APP_THEME_OPTIONS)('applies the saved $label theme to Welcome', async ({ value }) => {
    await database.saveSettings({ ...DEFAULT_SETTINGS, theme: value });
    openApp('/welcome');
    await screen.findByRole('heading', { name: welcomeTitle });
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', value));
  });
});
