import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import { TERMS_VERSION } from '../app/legal';
import { saveTermsAcceptance } from '../core/storage/database';
import { BOARD_COLUMNS, BOARD_ROWS, SHAPES, createGame, levelForRows, play } from '../features/easter-egg/falling-blocks';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function dragTransfer(files: File[] = []) {
  const types = files.length ? ['Files'] : [];
  return { files, types, setData: (type: string) => types.push(type) };
}

it('opens only for a drag from the header logo and starts fresh after closing', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await saveTermsAcceptance({ accepted: true, termsVersion: TERMS_VERSION, acceptedAt: 1 });
  const { container } = render(<App />);
  await screen.findByRole('heading', { name: 'Your Library is Empty' }, { timeout: 5000 });
  const logo = container.querySelector('header img[draggable="true"]')!;
  const target = container.querySelector('main')!;
  const transfer = dragTransfer();
  const eggName = /you’ve discovered an easter egg/i;

  fireEvent.dragStart(logo, { dataTransfer: transfer });
  fireEvent.dragEnter(target, { dataTransfer: transfer });
  expect(screen.getByText('Drop book, comic, or image to import')).toBeInTheDocument();
  fireEvent.dragEnd(logo, { dataTransfer: transfer });
  fireEvent.drop(target, { dataTransfer: transfer });
  expect(screen.queryByRole('dialog', { name: eggName })).not.toBeInTheDocument();
  expect(screen.queryByText('Drop book, comic, or image to import')).not.toBeInTheDocument();

  const openEgg = () => {
    const dataTransfer = dragTransfer();
    fireEvent.dragStart(logo, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    return screen.getByRole('group', { name: 'Falling blocks board' });
  };
  const board = openEgg();
  expect(screen.getByRole('dialog', { name: eggName })).toBeInTheDocument();
  await waitFor(() => expect(board).toHaveFocus());
  fireEvent.keyDown(board, { key: ' ' });
  expect(Number(screen.getByText('Score').nextElementSibling?.textContent)).toBeGreaterThan(0);
  fireEvent.keyDown(board, { key: 'p' });
  expect(screen.getByText('Paused')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(screen.queryByText('Paused')).not.toBeInTheDocument();

  fireEvent.keyDown(board, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: eggName })).not.toBeInTheDocument();
  openEgg();
  expect(screen.getByText('Score').nextElementSibling).toHaveTextContent(/^0$/);
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

  const fileDrop = dragTransfer([new File(['<svg/>'], 'webxreader.svg', { type: 'image/svg+xml' })]);
  fireEvent.dragOver(target, { dataTransfer: fileDrop });
  expect(screen.getByText('Drop book, comic, or image to import')).toBeInTheDocument();
  fireEvent.drop(target, { dataTransfer: fileDrop });
  expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: eggName })).not.toBeInTheDocument();
});

it('clears rows, advances levels, and reaches a restartable game over', () => {
  const start = createGame(123);
  const bottom = Array.from({ length: BOARD_COLUMNS }, (_, x) => x < 3 ? null : 1);
  const ready = {
    ...start,
    board: [...start.board.slice(0, -1), bottom],
    piece: { shape: 0, cells: SHAPES[0], x: 0, y: 0 },
    rows: 5,
  };
  const cleared = play(ready, { type: 'drop' });
  expect(cleared.rows).toBe(6);
  expect(cleared.score).toBeGreaterThanOrEqual(100);
  expect(levelForRows(cleared.rows)).toBe(2);
  expect(cleared.board).toEqual(start.board);
  expect(bottom[0]).toBeNull();

  let stacked = createGame(456);
  for (let i = 0; i < BOARD_ROWS && stacked.status === 'playing'; i++) {
    stacked = play(stacked, { type: 'drop' });
  }
  expect(stacked.status).toBe('over');
  expect(play(stacked, { type: 'tick' })).toBe(stacked);
  expect(play(stacked, { type: 'restart', seed: 123 })).toEqual(start);
});
