import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { SearchInput } from '../components/common/SearchInput';
import { ImportDialog } from '../components/library/ImportDialog';
import { BookOpen } from 'lucide-react';

describe('Common UI Components', () => {
  it('renders Button with variants and handles clicks', () => {
    const handleClick = vi.fn();
    render(
      <Button variant="primary" onClick={handleClick}>
        Click Me
      </Button>
    );

    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders EmptyState with icon, title, description, and action button', () => {
    const handleAction = vi.fn();
    render(
      <EmptyState
        icon={BookOpen}
        title="Empty Bookshelf"
        description="No books found in your library."
        action={{ label: 'Import Book', onClick: handleAction }}
      />
    );

    expect(screen.getByText('Empty Bookshelf')).toBeInTheDocument();
    expect(screen.getByText('No books found in your library.')).toBeInTheDocument();

    const actionBtn = screen.getByRole('button', { name: /import book/i });
    fireEvent.click(actionBtn);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('renders SearchInput and allows typing with clear button', () => {
    const handleChange = vi.fn();
    render(
      <SearchInput
        placeholder="Search books…"
        onChange={handleChange}
      />
    );

    const input = screen.getByPlaceholderText('Search books…') as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'fantasy' } });
    expect(input.value).toBe('fantasy');

    // Clear button appears
    const clearBtn = screen.getByLabelText('Clear search');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(input.value).toBe('');
  });

  it('imports every file in a multi-file selection', async () => {
    const onImportSuccess = vi.fn().mockResolvedValue(undefined);
    const first = new File(['Chapter One\nFirst book'], 'first-batch-book.txt', { type: 'text/plain' });
    const second = new File(['Chapter One\nSecond book'], 'second-batch-book.txt', { type: 'text/plain' });

    render(
      <ImportDialog
        isOpen
        onClose={vi.fn()}
        onImportSuccess={onImportSuccess}
        onOpenExisting={vi.fn()}
        initialFiles={[first, second]}
      />
    );

    await waitFor(() => expect(onImportSuccess).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(screen.getByRole('dialog', { name: 'Import Results' })).toBeInTheDocument();
    expect(screen.getByText('first-batch-book.txt')).toBeInTheDocument();
    expect(screen.getByText('second-batch-book.txt')).toBeInTheDocument();
  });
});
