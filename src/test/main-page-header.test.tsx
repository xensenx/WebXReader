import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SidePanelProvider } from '../app/providers/SidePanelContext';
import { MainPageHeader } from '../components/common/MainPageHeader';

afterEach(cleanup);

it('keeps Tab navigation in the active dialog and restores focus on Escape', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><SidePanelProvider><MainPageHeader /></SidePanelProvider></MemoryRouter>);
  const toggle = screen.getByRole('button', { name: 'Open menu' });
  await user.click(toggle);
  const menu = screen.getByRole('dialog', { name: 'Menu' });
  const close = screen.getByRole('button', { name: 'Close menu' });
  const donate = screen.getByRole('button', { name: 'Donate' });
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(donate).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Library' })).toHaveFocus();

  for (const shiftKey of [false, true]) {
    menu.focus();
    await user.tab({ shift: shiftKey });
    expect(shiftKey ? donate : close).toHaveFocus();
  }

  await user.click(donate);
  const dialog = screen.getByRole('dialog', { name: 'Donate' });
  const donationClose = screen.getByRole('button', { name: 'Close donation details' });
  const support = screen.getByRole('link', { name: 'Support on Ko-fi' });
  expect(menu.parentElement).toHaveAttribute('inert');
  expect(menu.parentElement).toHaveAttribute('aria-hidden', 'true');
  expect(donationClose).toHaveFocus();
  await user.tab({ shift: true });
  expect(support).toHaveFocus();
  await user.tab();
  expect(donationClose).toHaveFocus();
  await user.tab();
  expect(support).toHaveFocus();

  for (const shiftKey of [false, true]) {
    dialog.focus();
    await user.tab({ shift: shiftKey });
    expect(shiftKey ? support : donationClose).toHaveFocus();
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Tab', shiftKey });
    expect(shiftKey ? support : donationClose).toHaveFocus();
  }

  await user.keyboard('{Escape}');
  expect(donate).toHaveFocus();
  expect(menu.parentElement).not.toHaveAttribute('inert');
  await user.keyboard('{Escape}');
  expect(toggle).toHaveFocus();
});

it('returns focus when donation details are dismissed with the close button or backdrop', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><SidePanelProvider><MainPageHeader /></SidePanelProvider></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: 'Open menu' }));
  const donate = screen.getByRole('button', { name: 'Donate' });
  await user.click(donate);
  await user.click(screen.getByRole('button', { name: 'Close donation details' }));
  expect(donate).toHaveFocus();
  await user.click(donate);
  fireEvent.click(screen.getByRole('dialog', { name: 'Donate' }).parentElement!);
  expect(donate).toHaveFocus();
});
