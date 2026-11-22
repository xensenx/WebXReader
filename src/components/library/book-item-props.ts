import type { PointerEvent } from 'react';
import type { Book, ReadingStatus } from '../../types/book';

interface BookMenuActions {
  onAddToSeries: (id: string) => void;
  onEdit: (book: Book) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateStatus: (id: string, status: ReadingStatus) => void;
  onToggleArchive: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (book: Book) => void;
}

export interface BookItemProps {
  book: Book;
  progress?: number;
  volumeLabel?: string;
  onOpen: (id: string) => void;
  actions?: BookMenuActions;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (id: string) => void;
  isDragging?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  shouldSuppressClick?: () => boolean;
}
