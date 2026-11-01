/**
 * LibraryView component: the primary home screen of WebXReader.
 */

import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  getLibraryViewState,
  saveLibraryViewState,
  updateLibraryScroll,
} from '../../features/library/library-state';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Settings as SettingsIcon,
  Upload,
  BookX,
  SearchX,
  ArrowRight,
  Archive,
  CheckCircle,
  Circle,
  Trash2,
} from 'lucide-react';
import { useBooks } from '../../hooks/useBooks';
import { useSettingsContext } from '../../app/providers/SettingsContext';
import { updateBook, updateBookAndCover } from '../../core/storage/database';
import { downloadOriginalBook } from '../../features/export/backup-service';
import type {
  Book,
  LibraryFilter,
} from '../../types/book';

import { BookCard } from './BookCard';
import { BookList } from './BookList';
import { LibraryToolbar } from './LibraryToolbar';
import { ImportDialog } from './ImportDialog';
import { BookDetailsDialog } from './BookDetailsDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';

import styles from './LibraryView.module.css';

interface BookPointerDrag {
  bookId: string;
  pointerId: number;
  pointerType: string;
  captureElement: HTMLElement;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  width: number;
  height: number;
  active: boolean;
  order: string[];
  startOrder: string[];
}

interface BookDragPreview {
  book: Book;
  width: number;
  height: number;
  left: number;
  top: number;
}

const TOUCH_SLOP_PX = 14;
const TOUCH_HOLD_DELAY_MS = 180;

interface BookLayoutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// FLIP animations translate cards visually while their layout slots have already
// moved. Use the untransformed layout box for hit testing so an in-flight
// animation cannot change the reorder decision underneath a slow pointer.
function getBookLayoutRect(element: HTMLElement): BookLayoutRect {
  const offsetParent = element.offsetParent;
  if (!(offsetParent instanceof HTMLElement)) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  const parentRect = offsetParent.getBoundingClientRect();
  const left = parentRect.left + offsetParent.clientLeft + element.offsetLeft - offsetParent.scrollLeft;
  const top = parentRect.top + offsetParent.clientTop + element.offsetTop - offsetParent.scrollTop;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

export function LibraryView() {
  const navigate = useNavigate();
  const { books, loading, refreshBooks, removeBook, removeBooks, toggleFavorite, updateReadingStatus, toggleArchive } = useBooks();
  const { settings, updateSettings } = useSettingsContext();

  // Synchronously load saved library state (survives reader visits, format switches & page refreshes)
  const initialSavedStateRef = useRef(getLibraryViewState());
  const isRestoredRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

  // Search, filter, and sort state
  const [searchQuery, setSearchQuery] = useState(() => initialSavedStateRef.current.searchQuery);
  const [filter, setFilter] = useState<LibraryFilter>(() => initialSavedStateRef.current.filter);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(() => new Set());

  // Dialog states
  const [importOpen, setImportOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [detailsBook, setDetailsBook] = useState<Book | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Global drag-and-drop overlay
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const sortField = settings.librarySortField === 'lastOpenedAt' ? 'custom' : settings.librarySortField;
  const sortDirection = settings.librarySortDirection;

  // Custom book ordering state for drag-and-drop
  const [customOrder, setCustomOrder] = useState<string[]>(() => settings.customBookOrder ?? []);
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const [dragSortPreview, setDragSortPreview] = useState(false);
  const draggedIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<BookPointerDrag | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollSpeedRef = useRef<number>(0);
  const [dragPreview, setDragPreview] = useState<BookDragPreview | null>(null);
  const dragPreviewElementRef = useRef<HTMLDivElement | null>(null);
  const suppressBookClickRef = useRef(false);
  const suppressBookClickTimerRef = useRef<number | null>(null);
  const bookItemsRef = useRef<HTMLDivElement | null>(null);
  const pendingReorderPositionsRef = useRef<Map<string, DOMRect> | null>(null);
  const reorderAnimationsRef = useRef(new WeakMap<HTMLElement, Animation>());

  useEffect(() => {
    if (settings.customBookOrder && settings.customBookOrder.length > 0) {
      setCustomOrder(settings.customBookOrder);
    }
  }, [settings.customBookOrder]);

  // Layout preference
  const layout = settings.libraryLayout || 'grid';
  const handleLayoutChange = (newLayout: 'grid' | 'list') => {
    updateSettings({ libraryLayout: newLayout });
  };

  // Find most recent book to "Continue Reading"
  const continueBook = useMemo(() => {
    const readingBooks = books
      .filter((b) => !b.archived && (b.readingStatus === 'reading' || (b.lastOpenedAt && b.lastOpenedAt > 0)))
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    return readingBooks[0] || null;
  }, [books]);

  // Filtered & sorted book collection
  const filteredBooks = useMemo(() => {
    let result = [...books];

    // Filter
    switch (filter) {
      case 'reading':
        result = result.filter((b) => b.readingStatus === 'reading' && !b.archived);
        break;
      case 'unread':
        result = result.filter((b) => b.readingStatus === 'unread' && !b.archived);
        break;
      case 'completed':
        result = result.filter((b) => b.readingStatus === 'completed' && !b.archived);
        break;
      case 'favorites':
        result = result.filter((b) => b.favorite && !b.archived);
        break;
      case 'archived':
        result = result.filter((b) => b.archived);
        break;
      case 'all':
      default:
        result = result.filter((b) => !b.archived);
        break;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          (b.userTags && b.userTags.some((t) => t.toLowerCase().includes(q))) ||
          (b.originalFilename && b.originalFilename.toLowerCase().includes(q)) ||
          b.sourceFormat.toLowerCase().includes(q)
      );
    }

    // Sorting
    if (sortField === 'custom' || dragSortPreview) {
      const orderMap = new Map(customOrder.map((id, index) => [id, index]));
      result.sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
        if (orderA !== orderB) return orderA - orderB;
        return b.importedAt - a.importedAt;
      });
    } else {
      result.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'author':
            comparison = (a.author || '').localeCompare(b.author || '');
            break;
          case 'importedAt':
          default:
            comparison = a.importedAt - b.importedAt;
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [books, filter, searchQuery, sortField, sortDirection, customOrder, dragSortPreview]);

  useLayoutEffect(() => {
    const previousPositions = pendingReorderPositionsRef.current;
    pendingReorderPositionsRef.current = null;
    const container = bookItemsRef.current;
    if (!previousPositions || !container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const elementsById = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      if (element.dataset.bookId) elementsById.set(element.dataset.bookId, element);
    });

    for (const [bookId, previousRect] of previousPositions) {
      const element = elementsById.get(bookId);
      if (!element) continue;
      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

      reorderAnimationsRef.current.get(element)?.cancel();
      const animation = element.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      reorderAnimationsRef.current.set(element, animation);
    }
  }, [filteredBooks, layout]);

  const selectedBooks = useMemo(
    () => books.filter((book) => selectedBookIds.has(book.id)),
    [books, selectedBookIds]
  );
  const allVisibleBooksSelected = filteredBooks.length > 0 &&
    filteredBooks.every((book) => selectedBookIds.has(book.id));

  const toggleSelectionMode = () => {
    const nextMode = !selectionMode;
    setSelectionMode(nextMode);
    if (!nextMode) clearSelection();
  };

  const toggleBookSelection = (id: string) => {
    setSelectedBookIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedBookIds((previous) => {
      const next = new Set(previous);
      if (allVisibleBooksSelected) filteredBooks.forEach((book) => next.delete(book.id));
      else filteredBooks.forEach((book) => next.add(book.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedBookIds(new Set());

  const updateSelectedBooks = async (
    changes: Partial<Pick<Book, 'archived' | 'readingStatus'>>,
    clearAfterUpdate = true,
  ) => {
    try {
      const updatedAt = Date.now();
      for (const book of selectedBooks) {
        const { readingProgress: _readingProgress, ...storedBook } = book;
        await updateBook({ ...storedBook, ...changes, updatedAt });
      }
      if (clearAfterUpdate) clearSelection();
      await refreshBooks();
    } catch (err) {
      await refreshBooks();
      alert(`Could not update selected books: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteSelected = async () => {
    try {
      await removeBooks(selectedBooks.map((book) => book.id));
      clearSelection();
    } catch (err) {
      alert(`Could not delete selected books: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Prevent browser's premature scroll snapping on navigation
  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // Track window scroll position after restoration has completed
  useEffect(() => {
    isNavigatingRef.current = false;

    const onScroll = () => {
      if (isNavigatingRef.current || !isRestoredRef.current) return;
      if (scrollRafRef.current !== null) return;

      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        if (!isNavigatingRef.current && isRestoredRef.current) {
          const currentY = Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            document.body.scrollTop || 0
          );
          updateLibraryScroll(currentY);
        }
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      isNavigatingRef.current = true;
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Cleanup drag timers on unmount or blur, and intercept active touch moves
  useEffect(() => {
    const handleGlobalCancel = () => {
      clearLongPressTimer();
      stopAutoScroll();
      document.body.style.touchAction = '';
      document.body.style.userSelect = '';
      if (pointerDragRef.current?.active) {
        pendingReorderPositionsRef.current = captureBookPositions();
        cancelBookReorderAnimations();
        setCustomOrder(settings.customBookOrder ?? []);
        setDragSortPreview(false);
      }
      pointerDragRef.current = null;
      draggedIdRef.current = null;
      setDraggingBookId(null);
      setDragPreview(null);
    };

    const handleWindowTouchMove = (e: TouchEvent) => {
      // When a touch drag is active, cancel native viewport scrolling so the drag stays
      // fully under application control and the browser does not abort via pointercancel.
      if (pointerDragRef.current?.active) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('blur', handleGlobalCancel);
    return () => {
      clearLongPressTimer();
      stopAutoScroll();
      document.body.style.touchAction = '';
      document.body.style.userSelect = '';
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('blur', handleGlobalCancel);
    };
  }, [settings.customBookOrder]);

  // Restore scroll position when books are ready
  useLayoutEffect(() => {
    if (loading) return;
    if (isRestoredRef.current) return;

    const targetY = initialSavedStateRef.current.scrollY;
    const targetBookId = initialSavedStateRef.current.lastOpenedBookId;

    if (targetY <= 0 && !targetBookId) {
      isRestoredRef.current = true;
      return;
    }

    let frameId: number | null = null;
    let attempts = 0;
    const maxAttempts = 15;

    const attemptRestore = () => {
      attempts++;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      // Find target book card if available for dual-anchoring
      const targetCard = targetBookId
        ? document.querySelector<HTMLElement>(`[data-book-id="${targetBookId}"]`)
        : null;

      if (targetY > 0 && maxScroll >= targetY) {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        isRestoredRef.current = true;
        return;
      }

      if (maxScroll > 0 && targetY > 0) {
        window.scrollTo({ top: Math.min(targetY, maxScroll), behavior: 'instant' as ScrollBehavior });
      }

      if (attempts < maxAttempts) {
        frameId = requestAnimationFrame(attemptRestore);
      } else {
        if (targetY > 0 && maxScroll >= targetY) {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        } else if (targetCard) {
          targetCard.scrollIntoView({ block: 'center', behavior: 'instant' });
        } else if (targetY > 0) {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        }
        isRestoredRef.current = true;
      }
    };

    attemptRestore();

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [loading, filteredBooks.length]);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    saveLibraryViewState({ searchQuery: query, scrollY: 0, lastOpenedBookId: null });
  };

  const handleFilterChange = (newFilter: LibraryFilter) => {
    setFilter(newFilter);
    saveLibraryViewState({ filter: newFilter, scrollY: 0, lastOpenedBookId: null });
  };

  // Custom drag-and-drop book reordering handlers
  const captureBookPositions = (bookIds?: ReadonlySet<string>) => {
    const positions = new Map<string, DOMRect>();
    bookItemsRef.current?.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      const id = element.dataset.bookId;
      if (id && (!bookIds || bookIds.has(id))) positions.set(id, element.getBoundingClientRect());
    });
    return positions;
  };

  const cancelBookReorderAnimations = (bookIds?: ReadonlySet<string>) => {
    bookItemsRef.current?.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      const id = element.dataset.bookId;
      if (!id || (bookIds && !bookIds.has(id))) return;
      reorderAnimationsRef.current.get(element)?.cancel();
      reorderAnimationsRef.current.delete(element);
    });
  };

  const getBookElementAtPoint = (clientX: number, clientY: number): HTMLElement | null => {
    const container = bookItemsRef.current;
    if (!container) return null;

    let closestElement: HTMLElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    container.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      if (element.dataset.bookId === draggedIdRef.current) return;
      const rect = getBookLayoutRect(element);
      const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestElement = element;
      }
    });

    return closestElement;
  };

  const getReorderForDropTarget = (targetElement: HTMLElement, clientX: number, clientY: number) => {
    const drag = pointerDragRef.current;
    const sourceId = drag?.bookId;
    const targetId = targetElement.dataset.bookId;
    if (!drag?.active || !sourceId || !targetId || sourceId === targetId) return null;

    const currentOrder = drag.order;
    const sourceIndex = currentOrder.indexOf(sourceId);
    const targetIndex = currentOrder.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;

    const targetRect = getBookLayoutRect(targetElement);
    const horizontalDeadZone = Math.max(12, Math.min(24, targetRect.width * 0.1));
    const verticalDeadZone = Math.max(12, Math.min(28, targetRect.height * 0.08));
    const columnCount = layout === 'grid' && bookItemsRef.current
      ? getComputedStyle(bookItemsRef.current).gridTemplateColumns.split(' ').filter(Boolean).length
      : 1;
    let pointerIsAfterTarget: boolean;
    if (columnCount > 1 && clientY < targetRect.top - verticalDeadZone) {
      pointerIsAfterTarget = false;
    } else if (columnCount > 1 && clientY > targetRect.bottom + verticalDeadZone) {
      pointerIsAfterTarget = true;
    } else if (columnCount > 1) {
      const horizontalOffset = clientX - (targetRect.left + targetRect.width / 2);
      if (Math.abs(horizontalOffset) <= horizontalDeadZone) return null;
      pointerIsAfterTarget = horizontalOffset > 0;
    } else {
      const verticalOffset = clientY - (targetRect.top + targetRect.height / 2);
      if (Math.abs(verticalOffset) <= verticalDeadZone) return null;
      pointerIsAfterTarget = verticalOffset > 0;
    }

    const nextOrder = [...currentOrder];
    nextOrder.splice(sourceIndex, 1);
    let insertAt = nextOrder.indexOf(targetId);
    if (insertAt < 0) return null;
    if (pointerIsAfterTarget) insertAt++;
    nextOrder.splice(insertAt, 0, sourceId);

    if (nextOrder.every((id, index) => id === currentOrder[index])) return null;

    const affectedStart = Math.min(sourceIndex, targetIndex);
    const affectedEnd = Math.max(sourceIndex, targetIndex);
    return {
      nextOrder,
      affectedIds: new Set(currentOrder.slice(affectedStart, affectedEnd + 1)),
    };
  };

  const updateBookDropPreview = (clientX: number, clientY: number) => {
    const containerRect = bookItemsRef.current?.getBoundingClientRect();
    if (!containerRect || clientX < containerRect.left || clientX > containerRect.right ||
      clientY < containerRect.top || clientY > containerRect.bottom) return;

    const target = getBookElementAtPoint(clientX, clientY);
    if (!target) return;
    const reorder = getReorderForDropTarget(target, clientX, clientY);
    if (!reorder) return;
    pendingReorderPositionsRef.current = captureBookPositions(reorder.affectedIds);
    // Capture the cards' current visual positions, then stop their old FLIP
    // transforms before React applies the next order. The following layout
    // effect can then animate from the captured position to the true new slot.
    cancelBookReorderAnimations(reorder.affectedIds);
    if (pointerDragRef.current) pointerDragRef.current.order = reorder.nextOrder;
    setCustomOrder(reorder.nextOrder);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const stopAutoScroll = () => {
    autoScrollSpeedRef.current = 0;
    if (autoScrollRafRef.current !== null) {
      window.cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  };

  const triggerAutoScroll = (clientY: number) => {
    const edgeThreshold = 80;
    const maxScrollStep = 12;
    const viewportHeight = window.innerHeight;
    let scrollSpeed = 0;

    if (clientY < edgeThreshold) {
      const intensity = (edgeThreshold - Math.max(0, clientY)) / edgeThreshold;
      scrollSpeed = -Math.round(intensity * maxScrollStep);
    } else if (clientY > viewportHeight - edgeThreshold) {
      const intensity = (Math.min(viewportHeight, clientY) - (viewportHeight - edgeThreshold)) / edgeThreshold;
      scrollSpeed = Math.round(intensity * maxScrollStep);
    }

    autoScrollSpeedRef.current = scrollSpeed;

    if (scrollSpeed === 0) {
      stopAutoScroll();
      return;
    }

    if (autoScrollRafRef.current === null) {
      const step = () => {
        const currentDrag = pointerDragRef.current;
        const currentSpeed = autoScrollSpeedRef.current;
        if (!currentDrag?.active || currentSpeed === 0) {
          stopAutoScroll();
          return;
        }

        window.scrollBy(0, currentSpeed);
        updateBookDropPreview(currentDrag.currentX, currentDrag.currentY);
        autoScrollRafRef.current = window.requestAnimationFrame(step);
      };
      autoScrollRafRef.current = window.requestAnimationFrame(step);
    }
  };

  const handleBookPointerDown = (id: string, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || pointerDragRef.current) return;
    if ((e.target as HTMLElement).closest('button, a, input, [role="menu"]')) return;

    clearLongPressTimer();
    stopAutoScroll();

    const previewSource = e.currentTarget.querySelector<HTMLElement>('[data-drag-preview]');
    const previewBounds = previewSource?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
    const currentOrder = filteredBooks.map((book) => book.id);
    const targetElement = e.currentTarget;
    const targetPointerId = e.pointerId;

    const drag: BookPointerDrag = {
      bookId: id,
      pointerId: targetPointerId,
      pointerType: e.pointerType,
      captureElement: targetElement,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      width: Math.max(1, previewBounds.width),
      height: Math.max(1, previewBounds.height),
      active: false,
      order: currentOrder,
      startOrder: currentOrder,
    };
    pointerDragRef.current = drag;

    if (e.pointerType === 'touch') {
      // Touch devices: wait for press-and-hold without moving to distinguish from scrolling
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const currentDrag = pointerDragRef.current;
        if (!currentDrag || currentDrag.pointerId !== targetPointerId || currentDrag.active) return;

        currentDrag.active = true;
        draggedIdRef.current = currentDrag.bookId;
        pendingReorderPositionsRef.current = null;
        setDraggingBookId(currentDrag.bookId);

        // Lock document-level panning during active touch drag
        document.body.style.touchAction = 'none';
        document.body.style.userSelect = 'none';

        if (sortField !== 'custom') {
          setCustomOrder(currentDrag.order);
          setDragSortPreview(true);
        }

        const draggedBook = books.find((b) => b.id === currentDrag.bookId);
        if (draggedBook) {
          setDragPreview({
            book: draggedBook,
            width: currentDrag.width,
            height: currentDrag.height,
            left: currentDrag.currentX - currentDrag.width / 2,
            top: currentDrag.currentY - currentDrag.height / 2,
          });
        }

        try {
          targetElement.setPointerCapture(targetPointerId);
        } catch {
          // ignore if already captured or failed
        }

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(35);
          } catch {
            // vibration not supported or allowed
          }
        }

        suppressBookClickRef.current = true;
      }, TOUCH_HOLD_DELAY_MS);
    } else {
      // Mouse/pen: capture pointer immediately
      try {
        targetElement.setPointerCapture(e.pointerId);
      } catch {
        pointerDragRef.current = null;
      }
    }
  };

  const handleLibraryPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    drag.currentX = e.clientX;
    drag.currentY = e.clientY;

    if (!drag.active) {
      const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);

      if (drag.pointerType === 'touch') {
        // If finger moved > TOUCH_SLOP_PX before long press completed, user is scrolling
        if (distance > TOUCH_SLOP_PX) {
          clearLongPressTimer();
          pointerDragRef.current = null;
        }
        return;
      }

      if (distance < 6) return;

      drag.active = true;
      draggedIdRef.current = drag.bookId;
      pendingReorderPositionsRef.current = null;
      setDraggingBookId(drag.bookId);
      if (sortField !== 'custom') {
        setCustomOrder(drag.order);
        setDragSortPreview(true);
      }

      const draggedBook = books.find((book) => book.id === drag.bookId);
      if (draggedBook) {
        setDragPreview({
          book: draggedBook,
          width: drag.width,
          height: drag.height,
          left: e.clientX - drag.width / 2,
          top: e.clientY - drag.height / 2,
        });
      }
    }

    e.preventDefault();
    const left = e.clientX - drag.width / 2;
    const top = e.clientY - drag.height / 2;
    const previewElement = dragPreviewElementRef.current;
    if (previewElement) previewElement.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    updateBookDropPreview(e.clientX, e.clientY);
    triggerAutoScroll(e.clientY);
  };

  const shouldSuppressBookClick = () => {
    if (!suppressBookClickRef.current) return false;
    suppressBookClickRef.current = false;
    if (suppressBookClickTimerRef.current !== null) {
      window.clearTimeout(suppressBookClickTimerRef.current);
      suppressBookClickTimerRef.current = null;
    }
    return true;
  };

  const finishBookPointerDrag = (e: ReactPointerEvent<HTMLDivElement>, canceled = false) => {
    clearLongPressTimer();
    stopAutoScroll();
    document.body.style.touchAction = '';
    document.body.style.userSelect = '';

    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (drag.active) {
      e.preventDefault();
      const containerRect = bookItemsRef.current?.getBoundingClientRect();
      const pointerInsideLibrary = Boolean(containerRect &&
        e.clientX >= containerRect.left && e.clientX <= containerRect.right &&
        e.clientY >= containerRect.top && e.clientY <= containerRect.bottom);

      if (!canceled && pointerInsideLibrary) {
        updateBookDropPreview(e.clientX, e.clientY);
      }

      const finalOrder = drag.order;
      const didReorder = finalOrder.some((bookId, index) => bookId !== drag.startOrder[index]);
      if (!canceled && pointerInsideLibrary && didReorder) {
        setCustomOrder(finalOrder);
        setDragSortPreview(false);
        void updateSettings({ librarySortField: 'custom', customBookOrder: finalOrder });
      } else {
        pendingReorderPositionsRef.current = captureBookPositions();
        cancelBookReorderAnimations();
        setCustomOrder(settings.customBookOrder ?? []);
        setDragSortPreview(false);
      }

      suppressBookClickRef.current = true;
      if (suppressBookClickTimerRef.current !== null) window.clearTimeout(suppressBookClickTimerRef.current);
      suppressBookClickTimerRef.current = window.setTimeout(() => {
        suppressBookClickRef.current = false;
        suppressBookClickTimerRef.current = null;
      }, 250);
    }

    try {
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // The browser may already have released capture after a canceled pointer sequence.
    }

    pointerDragRef.current = null;
    draggedIdRef.current = null;
    setDraggingBookId(null);
    setDragPreview(null);
  };

  // Book action handlers
  const handleOpenBook = (id: string) => {
    isNavigatingRef.current = true;
    isRestoredRef.current = false;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }

    const currentY = Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );

    saveLibraryViewState({
      scrollY: currentY,
      lastOpenedBookId: id,
      searchQuery,
      filter,
    });
    navigate(`/read/${id}`);
  };

  const handleEditBook = (book: Book) => {
    setDetailsBook(book);
  };

  const handleSaveBookDetails = async (updated: Book) => {
    const storedBook = { ...updated } as Book & { readingProgress?: number };
    delete storedBook.readingProgress;
    await updateBookAndCover(storedBook, storedBook.coverImage);
    await refreshBooks();
  };

  const handleExportBook = async (id: string) => {
    try {
      await downloadOriginalBook(id);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      await removeBook(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  // Drag and drop events on entire window/main
  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-webxreader-book')) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Only deactivate if leaving the container itself
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (draggedIdRef.current || e.dataTransfer.types.includes('application/x-webxreader-book')) return;
    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setDroppedFiles(Array.from(e.dataTransfer.files));
      setImportOpen(true);
    }
  };

  return (
    <div
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPointerMove={handleLibraryPointerMove}
      onPointerUp={(e) => finishBookPointerDrag(e)}
      onPointerCancel={(e) => finishBookPointerDrag(e, true)}
      onContextMenu={(e) => {
        if (pointerDragRef.current) e.preventDefault();
      }}
    >
      {/* App Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <img
            src="/webxreader.svg"
            alt=""
            className={styles.brandLogo}
            aria-hidden="true"
          />
          <span>WebXReader</span>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.iconButton}
            onClick={() => navigate('/settings')}
            title="Application Settings & Backup"
            aria-label="Settings"
            type="button"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={styles.main}>
        {/* Continue Reading Section */}
        {continueBook && filter === 'all' && !searchQuery && (
          <section
            className={styles.continueSection}
            onClick={() => handleOpenBook(continueBook.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleOpenBook(continueBook.id);
            }}
            aria-label={`Continue reading ${continueBook.title}`}
          >
            <div className={styles.continueLeft}>
              {continueBook.coverImage ? (
                <img
                  src={continueBook.coverImage}
                  alt=""
                  className={styles.continueCover}
                />
              ) : (
                <div className={styles.continueFallbackCover}>
                  {continueBook.title.trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div className={styles.continueInfo}>
                <span className={styles.continueTag}>Continue Reading</span>
                <h3 className={styles.continueTitle}>{continueBook.title}</h3>
                <span className={styles.continueAuthor}>
                  {continueBook.author || 'Unknown Author'}
                </span>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              icon={<ArrowRight size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenBook(continueBook.id);
              }}
            >
              Resume
            </Button>
          </section>
        )}

        {/* Toolbar */}
        <LibraryToolbar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          filter={filter}
          onFilterChange={handleFilterChange}
          sortField={sortField}
          onSortFieldChange={(field) => updateSettings({ librarySortField: field })}
          sortDirection={sortDirection}
          onToggleSortDirection={() =>
            updateSettings({ librarySortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })
          }
          layout={layout}
          onLayoutChange={handleLayoutChange}
          selectionMode={selectionMode}
          onToggleSelectionMode={toggleSelectionMode}
          onImportClick={() => {
            setDroppedFiles(null);
            setImportOpen(true);
          }}
        />

        {selectionMode && (
          <div className={styles.selectionToolbar} role="toolbar" aria-label="Selected book actions">
            <div className={styles.selectionSummary} aria-live="polite">
              <strong>{selectedBooks.length}</strong>
              <span>{selectedBooks.length === 1 ? 'book selected' : 'books selected'}</span>
            </div>
            <div className={styles.selectionActions}>
              <Button
                size="sm"
                variant="secondary"
                onClick={toggleVisibleSelection}
                disabled={filteredBooks.length === 0}
              >
                {allVisibleBooksSelected ? 'Deselect visible' : 'Select visible'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Archive size={14} />}
                onClick={() => updateSelectedBooks({ archived: !selectedBooks.every((book) => book.archived) })}
                disabled={selectedBooks.length === 0}
              >
                {selectedBooks.length > 0 && selectedBooks.every((book) => book.archived) ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<CheckCircle size={14} />}
                onClick={() => updateSelectedBooks({ readingStatus: 'completed' }, false)}
                disabled={!selectedBooks.some((book) => book.readingStatus !== 'completed')}
              >
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Circle size={14} />}
                onClick={() => updateSelectedBooks({ readingStatus: 'unread' }, false)}
                disabled={!selectedBooks.some((book) => book.readingStatus !== 'unread')}
              >
                Mark unread
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => setBulkDeleteOpen(true)}
                disabled={selectedBooks.length === 0}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection} disabled={selectedBooks.length === 0}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Books Content / Empty States */}
        {!loading && books.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="Your Library is Empty"
            description="Import a book, comic, document, or image to get started. All items stay safely on your device."
            action={{
              label: 'Import First Book',
              onClick: () => {
                setDroppedFiles(null);
                setImportOpen(true);
              },
            }}
          />
        )}

        {!loading && books.length > 0 && filteredBooks.length === 0 && searchQuery && (
          <EmptyState
            icon={SearchX}
            title="No Results Found"
            description={`No books matched "${searchQuery}". Try searching by another keyword.`}
            action={{
              label: 'Clear Search',
              onClick: () => handleSearchChange(''),
            }}
          />
        )}

        {!loading && books.length > 0 && filteredBooks.length === 0 && !searchQuery && (
          <EmptyState
            icon={BookX}
            title={`No ${filter} books`}
            description={`You don't have any books matching the "${filter}" filter.`}
            action={{
              label: 'Show All Books',
              onClick: () => handleFilterChange('all'),
            }}
          />
        )}

        {!loading && filteredBooks.length > 0 && (
          <>
            {layout === 'grid' ? (
              <div ref={bookItemsRef} className={styles.bookGrid} role="feed" aria-label="Book library">
                {filteredBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    progress={book.readingProgress}
                    onOpen={handleOpenBook}
                    onEdit={handleEditBook}
                    onToggleFavorite={toggleFavorite}
                    onUpdateStatus={updateReadingStatus}
                    onToggleArchive={toggleArchive}
                    onExport={handleExportBook}
                    onDelete={(b) => setDeleteTarget(b)}
                    selectionMode={selectionMode}
                    selected={selectedBookIds.has(book.id)}
                    onToggleSelection={toggleBookSelection}
                    isDragging={draggingBookId === book.id}
                    onPointerDown={selectionMode ? undefined : (e) => handleBookPointerDown(book.id, e)}
                    shouldSuppressClick={shouldSuppressBookClick}
                  />
                ))}
              </div>
            ) : (
              <div ref={bookItemsRef} className={styles.bookList} role="feed" aria-label="Book library">
                {filteredBooks.map((book) => (
                  <BookList
                    key={book.id}
                    book={book}
                    progress={book.readingProgress}
                    onOpen={handleOpenBook}
                    onEdit={handleEditBook}
                    onToggleFavorite={toggleFavorite}
                    onUpdateStatus={updateReadingStatus}
                    onToggleArchive={toggleArchive}
                    onExport={handleExportBook}
                    onDelete={(b) => setDeleteTarget(b)}
                    selectionMode={selectionMode}
                    selected={selectedBookIds.has(book.id)}
                    onToggleSelection={toggleBookSelection}
                    isDragging={draggingBookId === book.id}
                    onPointerDown={selectionMode ? undefined : (e) => handleBookPointerDown(book.id, e)}
                    shouldSuppressClick={shouldSuppressBookClick}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {dragPreview && (
        <div
          ref={dragPreviewElementRef}
          className={styles.bookDragPreview}
          style={{
            width: `${dragPreview.width}px`,
            height: `${dragPreview.height}px`,
            transform: `translate3d(${dragPreview.left}px, ${dragPreview.top}px, 0)`,
          }}
          aria-hidden="true"
        >
          {dragPreview.book.coverImage ? (
            <img src={dragPreview.book.coverImage} alt="" className={styles.bookDragPreviewImage} draggable={false} />
          ) : (
            <div className={styles.bookDragPreviewFallback}>
              <span>{dragPreview.book.title.trim().charAt(0).toUpperCase()}</span>
              {dragPreview.width > 72 && <small>{dragPreview.book.sourceFormat.toUpperCase()}</small>}
            </div>
          )}
        </div>
      )}

      {/* Drag and Drop Overlay */}
      {isDraggingOver && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragCard}>
            <Upload size={48} />
            <span>Drop book, comic, or image to import</span>
          </div>
        </div>
      )}

      {/* Import Dialog */}
      <ImportDialog
        isOpen={importOpen}
        onClose={() => {
          setImportOpen(false);
          setDroppedFiles(null);
        }}
        initialFiles={droppedFiles}
        onImportSuccess={async (_newBook, openDirectly) => {
          await refreshBooks();
          if (openDirectly) {
            handleOpenBook(_newBook.id);
          }
        }}
        onOpenExisting={(id) => handleOpenBook(id)}
      />

      {/* Book Details Dialog */}
      <BookDetailsDialog
        book={detailsBook}
        isOpen={Boolean(detailsBook)}
        onClose={() => setDetailsBook(null)}
        onSave={handleSaveBookDetails}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Book"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? All associated reading progress, bookmarks, and annotations will be permanently deleted from this device.`}
        confirmLabel="Delete Permanently"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleDeleteSelected}
        title={`Delete ${selectedBooks.length} ${selectedBooks.length === 1 ? 'book' : 'books'}?`}
        message={`This will permanently delete ${selectedBooks.length === 1 ? 'this book' : 'these books'} and all associated reading progress, bookmarks, and annotations from this device.`}
        confirmLabel="Delete Permanently"
        variant="danger"
      />
    </div>
  );
}

