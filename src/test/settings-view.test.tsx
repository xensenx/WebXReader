import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SettingsView } from '../components/settings/SettingsView';
import { SettingsProvider } from '../app/providers/SettingsContext';

afterEach(cleanup);

function renderSettingsView(initialEntries = ['/settings']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <SettingsProvider>
        <Routes>
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/" element={<div>Library View Mock</div>} />
        </Routes>
      </SettingsProvider>
    </MemoryRouter>
  );
}

describe('SettingsView master-detail browser-style navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 5 dedicated navigation options on the left sidebar', () => {
    renderSettingsView();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);

    expect(screen.getByRole('tab', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reading options' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Local storage and privacy' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Backup and restoration' })).toBeInTheDocument();
  });

  it('defaults to Appearance section and only displays Appearance settings', () => {
    renderSettingsView();

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    expect(appearanceTab).toHaveAttribute('aria-selected', 'true');

    // Appearance settings should be present
    expect(screen.getByText('Application Theme')).toBeInTheDocument();

    // Other section contents should NOT be present
    expect(screen.queryByText('Default Reading Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Toggle Fullscreen')).not.toBeInTheDocument();
    expect(screen.queryByText('100% Local-First Promise:')).not.toBeInTheDocument();
    expect(screen.queryByText('Export Library Backup')).not.toBeInTheDocument();
  });

  it('switches to Reading options section and displays only its settings', async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const readingTab = screen.getByRole('tab', { name: 'Reading options' });
    await user.click(readingTab);

    expect(readingTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'false');

    // Reading options settings should be visible
    expect(screen.getByText('Default Reading Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Plain Text Chapter Detection')).toBeInTheDocument();
    expect(screen.getByLabelText('Large import warning size in megabytes')).toBeInTheDocument();

    // Appearance settings should not be visible
    expect(screen.queryByText('Application Theme')).not.toBeInTheDocument();
    expect(screen.queryByText('Toggle Fullscreen')).not.toBeInTheDocument();
  });

  it('switches to Keyboard shortcuts section and displays hotkey reference', async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const shortcutsTab = screen.getByRole('tab', { name: 'Keyboard shortcuts' });
    await user.click(shortcutsTab);

    expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Toggle Fullscreen')).toBeInTheDocument();
    expect(screen.getByText('Table of Contents')).toBeInTheDocument();
    expect(screen.getByText('Reader Settings')).toBeInTheDocument();

    expect(screen.queryByText('Application Theme')).not.toBeInTheDocument();
    expect(screen.queryByText('Default Reading Mode')).not.toBeInTheDocument();
  });

  it('switches to Local storage and privacy section and displays privacy details', async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const privacyTab = screen.getByRole('tab', { name: 'Local storage and privacy' });
    await user.click(privacyTab);

    expect(privacyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/100% Local-First Promise:/i)).toBeInTheDocument();
    expect(screen.getByText('Persistent Storage Status')).toBeInTheDocument();

    expect(screen.queryByText('Application Theme')).not.toBeInTheDocument();
    expect(screen.queryByText('Export Library Backup')).not.toBeInTheDocument();
  });

  it('switches to Backup and restoration section and displays backup controls', async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const backupTab = screen.getByRole('tab', { name: 'Backup and restoration' });
    await user.click(backupTab);

    expect(backupTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Export Library Backup')).toBeInTheDocument();
    expect(screen.getByText('Restore Library Backup')).toBeInTheDocument();
    expect(screen.getByText('Clear Library Data')).toBeInTheDocument();
    expect(screen.getByText('Reset Site Preferences')).toBeInTheDocument();

    expect(screen.queryByText('Application Theme')).not.toBeInTheDocument();
    expect(screen.queryByText('Default Reading Mode')).not.toBeInTheDocument();
  });

  it('supports initial section selection from URL query params', () => {
    renderSettingsView(['/settings?section=keyboard-shortcuts']);

    const shortcutsTab = screen.getByRole('tab', { name: 'Keyboard shortcuts' });
    expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Toggle Fullscreen')).toBeInTheDocument();
    expect(screen.queryByText('Application Theme')).not.toBeInTheDocument();
  });

  it('supports arrow key navigation across tabs', () => {
    renderSettingsView();

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' });
    appearanceTab.focus();

    // Arrow down to Reading options
    fireEvent.keyDown(appearanceTab, { key: 'ArrowDown' });
    const readingTab = screen.getByRole('tab', { name: 'Reading options' });
    expect(readingTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Default Reading Mode')).toBeInTheDocument();

    // Arrow up back to Appearance
    fireEvent.keyDown(readingTab, { key: 'ArrowUp' });
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates back to library on back button click', async () => {
    const user = userEvent.setup();
    renderSettingsView();

    const backButton = screen.getByRole('button', { name: 'Back to Library' });
    await user.click(backButton);

    expect(screen.getByText('Library View Mock')).toBeInTheDocument();
  });
});
