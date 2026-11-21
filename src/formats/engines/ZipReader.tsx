/**
 * General-purpose Archive Reader & Container Engine (ZIP & RAR).
 *
 * Provides a native directory explorer for navigating archives,
 * on-demand entry decompression, and seamless delegation to
 * WebXReader's existing format readers (EPUB, PDF, DJVU, Comics,
 * reflowable documents, and image galleries).
 */

import {
  useState,
  useEffect,
  useDeferredValue,
  useRef,
  useMemo,
  useImperativeHandle,
  type Ref,
  useCallback,
  memo,
  lazy,
  Suspense,
} from 'react';
import { openBudgetedZip, readZipEntryLimited } from '../../core/parsing/zip-budget';
import {
  Folder,
  BookOpen,
  FileText,
  Image as ImageIcon,
  FileCode,
  File,
  Layers,
  Search,
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  AlertTriangle,
  ChevronLeft,
} from 'lucide-react';
import type { BookFormat, Book, Chapter, ReadingMode } from '../../types/book';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import { createTextExcerpt, findTextMatches } from '../../utils/text-search';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import {
  indexValidatedZip,
  formatFileSize,
  type ZipEntryItem,
  type ZipItemKind,
} from '../../core/parsing/zip-parser';
import { naturalCompare } from '../../core/parsing/comic-archive';
import { parseTxt } from '../../core/parsing/txt-parser';
import { parseMarkdown } from '../../core/parsing/markdown-parser';
import { decodeHtmlDocument } from '../../core/parsing/html-encoding';
import { parseHtml } from '../../core/parsing/html-parser';
import { decodeRtfDocument, parseRtf } from '../../core/parsing/rtf-parser';
import { parseFb2 } from '../../core/parsing/fb2-parser';
import { parseMobi } from '../../core/parsing/mobi-parser';
import { parseAzw3 } from '../../core/parsing/azw3-parser';
import { parseDocx } from '../../core/parsing/docx-parser';
import { parseDoc } from '../../core/parsing/doc-parser';
import { parseMht } from '../../core/parsing/mht-parser';
import { openRarArchiveSession } from '../../core/parsing/rar-parser';

const PdfReader = lazy(async () => {
  const module = await import('./PdfReader');
  return { default: module.PdfReader };
});
const EpubReader = lazy(async () => {
  const module = await import('./EpubReader');
  return { default: module.EpubReader };
});
const CbzReader = lazy(async () => {
  const module = await import('./CbzReader');
  return { default: module.CbzReader };
});
const DjvuReader = lazy(async () => {
  const module = await import('./DjvuReader');
  return { default: module.DjvuReader };
});
import { ScrollReader } from '../../components/reader/ScrollReader';
import { PaginatedReader } from '../../components/reader/PaginatedReader';
import { DoubleSidedReader } from '../../components/reader/DoubleSidedReader';

import styles from './ZipReader.module.css';

export interface ArchiveReaderHandle {
  goToEntry(path: string, fraction?: number): void;
  goToProgress(fraction: number): void;
  searchEntries(query: string): Promise<ReaderSearchResult[]>;
}

interface EntryLocation {
  page: number;
  fraction: number;
  bookmarkFraction?: number;
  mode?: string;
}

export interface ArchiveReaderProps {
  ref?: Ref<ArchiveReaderHandle>;
  fileData: ArrayBuffer;
  book?: Book;
  archiveType?: 'zip' | 'rar';
  initialSubPath?: string;
  initialPage?: number;
  initialProgressFraction?: number;
  initialProgressMode?: string;
  readingMode?: ReadingMode;
  readerSettings: EffectiveReaderSettings;
  readerZoom?: number;
  zoomAnchor?: any;
  onProgressUpdate?: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
}

export type ZipReaderProps = ArchiveReaderProps;

export interface GenericArchiveSession {
  type: 'zip' | 'rar';
  entries: ZipEntryItem[];
  getEntryData(path: string): Promise<ArrayBuffer>;
  getEntryBlob(path: string, mimeType?: string): Promise<Blob>;
  getEntryText(path: string): Promise<string>;
  close(): void;
}

interface ActiveSubDocument {
  entry: ZipEntryItem;
  generation: number;
  fileBuffer?: ArrayBuffer;
  location: EntryLocation;
  chapters?: Chapter[];
}

interface ActiveImageCollection {
  folderPath: string;
  images: ZipEntryItem[];
  currentIndex: number;
}

export const ArchiveReader = memo(function ArchiveReader({
  ref,
  fileData,
  book,
  archiveType,
  initialSubPath,
  initialPage = 1,
  initialProgressFraction = 0,
  initialProgressMode,
  readingMode = 'scroll',
  readerSettings,
  readerZoom = 1,
  zoomAnchor,
  onProgressUpdate,
  onToggleControls,
}: ArchiveReaderProps) {
  const effectiveType: 'zip' | 'rar' = archiveType || (book?.sourceFormat === 'rar' ? 'rar' : 'zip');
  const [archiveSession, setArchiveSession] = useState<GenericArchiveSession | null>(null);
  const sessionRef = useRef<GenericArchiveSession | null>(null);

  const [entries, setEntries] = useState<ZipEntryItem[]>([]);
  const [loadingArchive, setLoadingArchive] = useState(true);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Navigation State
  const [currentFolder, setCurrentFolder] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const entryIndex = useMemo(() => {
    const byPath = new Map<string, ZipEntryItem>();
    const byFolder = new Map<string, ZipEntryItem[]>();
    for (const entry of entries) {
      byPath.set(entry.path, entry);
      byPath.set(entry.id, entry);
      const folder = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/')));
      let children = byFolder.get(folder);
      if (!children) {
        children = [];
        byFolder.set(folder, children);
      }
      children.push(entry);
    }
    return { byPath, byFolder };
  }, [entries]);

  // Active Reading State
  const [activeDoc, setActiveDoc] = useState<ActiveSubDocument | null>(null);
  const [activeCollection, setActiveCollection] = useState<ActiveImageCollection | null>(null);
  const subReaderStageRef = useRef<HTMLDivElement>(null);
  const subReaderRef = useRef<Pick<ArchiveReaderHandle, 'goToProgress'> | null>(null);
  const registerSubReader = useCallback((reader: Pick<ArchiveReaderHandle, 'goToProgress'> | null) => {
    subReaderRef.current = reader;
  }, []);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const entryGenerationRef = useRef(0);

  // Blob URLs for image collection caching and revocation
  const activeBlobUrlsRef = useRef<Map<string, string>>(new Map());
  const blobGenerationRef = useRef(0);
  const pendingBlobUrlsRef = useRef<Map<string, Promise<string | undefined>>>(new Map());

  const revokeActiveBlobUrls = () => {
    blobGenerationRef.current++;
    pendingBlobUrlsRef.current.clear();
    activeBlobUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    });
    activeBlobUrlsRef.current.clear();
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Open an individual supported file from the archive
  const openSubEntry = async (
    entry: ZipEntryItem, sessionOverride?: GenericArchiveSession,
    location: EntryLocation = { page: 1, fraction: 0 },
  ) => {
    const session = sessionOverride || archiveSession;
    if (!session) return;

    if (!entry.isSupported) {
      showToast(`Files with format ".${entry.name.split('.').pop()}" cannot be opened.`);
      return;
    }

    const generation = ++entryGenerationRef.current;
    setLoadingEntry(true);
    try {
      // If it's a standalone image, open as a single-item collection or sequence
      if (entry.kind === 'image') {
        const folder = entry.path.split('/').slice(0, -1).join('/');
        const siblingImages = session.entries.filter(
          (e) => !e.isDirectory && e.kind === 'image' && e.path.split('/').slice(0, -1).join('/') === folder
        );
        siblingImages.sort((a, b) => naturalCompare(a.name, b.name));
        const idx = siblingImages.findIndex((e) => e.path === entry.path);

        revokeActiveBlobUrls();
        setActiveDoc(null);
        const currentIndex = Math.max(0, idx);
        setActiveCollection({ folderPath: folder, images: siblingImages, currentIndex });
        onProgressUpdate?.(entry.path, currentIndex / Math.max(1, siblingImages.length - 1), currentIndex);
        return;
      }

      // Check if it's a binary reader format (EPUB, PDF, DJVU, Comics)
      if (
        entry.kind === 'epub' ||
        entry.kind === 'pdf' ||
        entry.kind === 'djvu' ||
        entry.kind === 'cbz' ||
        entry.kind === 'cbr' ||
        entry.kind === 'cb7'
      ) {
        const buffer = await session.getEntryData(entry.path);
        if (entry.kind === 'epub') await openBudgetedZip(buffer);
        if (generation !== entryGenerationRef.current) return;
        revokeActiveBlobUrls();
        setActiveCollection(null);
        setActiveDoc({
          entry,
          generation,
          fileBuffer: buffer,
          location,
        });
        if (location.fraction === 0 && location.page === 1) onProgressUpdate?.(entry.path, 0, 0);
        return;
      }

      // Reflowable text formats
      if (entry.kind === 'txt' || entry.kind === 'markdown' || entry.kind === 'html' || entry.kind === 'rtf') {
        const text = entry.kind === 'html'
          ? decodeHtmlDocument(await session.getEntryData(entry.path))
          : entry.kind === 'rtf'
            ? decodeRtfDocument(await session.getEntryData(entry.path))
            : await session.getEntryText(entry.path);
        let chapters: Chapter[] = [];

        if (entry.kind === 'txt') {
          chapters = parseTxt(text).chapters;
        } else if (entry.kind === 'markdown') {
          chapters = parseMarkdown(text).chapters;
        } else if (entry.kind === 'html') {
          chapters = parseHtml(text).chapters;
        } else if (entry.kind === 'rtf') {
          chapters = parseRtf(text).chapters;
        }

        if (generation !== entryGenerationRef.current) return;
        revokeActiveBlobUrls();
        setActiveCollection(null);
        setActiveDoc({ entry, generation, chapters, location });
        if (location.fraction === 0 && location.page === 1) onProgressUpdate?.(entry.path, 0, 0);
        return;
      }

      // Complex document formats (DOCX, DOC, FB2, MOBI, AZW3, MHT)
      const buffer = await session.getEntryData(entry.path);
      let chapters: Chapter[] = [];

      if (entry.kind === 'docx') {
        const parsed = await parseDocx(buffer);
        chapters = parsed.chapters;
      } else if (entry.kind === 'doc') {
        const parsed = await parseDoc(buffer);
        chapters = parsed.chapters;
      } else if (entry.kind === 'fb2') {
        const parsed = await parseFb2(buffer);
        chapters = parsed.chapters;
      } else if (entry.kind === 'mobi') {
        const parsed = await parseMobi(buffer);
        chapters = parsed.chapters;
      } else if (entry.kind === 'azw3') {
        const parsed = await parseAzw3(buffer);
        chapters = parsed.chapters;
      } else if (entry.kind === 'mht') {
        const parsed = await parseMht(buffer);
        chapters = parsed.chapters;
      }

      if (generation !== entryGenerationRef.current) return;
      revokeActiveBlobUrls();
      setActiveCollection(null);
      setActiveDoc({ entry, generation, chapters, location });
      if (location.fraction === 0 && location.page === 1) onProgressUpdate?.(entry.path, 0, 0);
    } catch (err) {
      if (generation === entryGenerationRef.current) showToast(`Failed to open entry: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (generation === entryGenerationRef.current) setLoadingEntry(false);
    }
  };

  // Load and parse archive on mount
  useEffect(() => {
    let isMounted = true;
    setLoadingArchive(true);
    setArchiveError(null);

    async function initArchive() {
      try {
        let session: GenericArchiveSession;

        if (effectiveType === 'rar') {
          const rarSession = await openRarArchiveSession(fileData, {
            filename: book?.originalFilename || book?.title,
          });
          if (!isMounted) {
            rarSession.close();
            return;
          }
          session = {
            type: 'rar',
            entries: rarSession.entries,
            getEntryData: (p) => rarSession.getEntryData(p),
            getEntryBlob: (p, mime) => rarSession.getEntryBlob(p, mime),
            getEntryText: (p) => rarSession.getEntryText(p),
            close: () => rarSession.close(),
          };
        } else {
          const loadedZip = await openBudgetedZip(fileData);
          const parsedResult = await indexValidatedZip(loadedZip, book?.originalFilename || book?.title, false);

          if (!isMounted) return;
          session = {
            type: 'zip',
            entries: parsedResult.entries,
            getEntryData: async (p) => {
              const fileObj = loadedZip.file(p);
              if (!fileObj) throw new Error(`File "${p}" not found in archive.`);
              return (await readZipEntryLimited(fileObj)).buffer as ArrayBuffer;
            },
            getEntryBlob: async (p, mime) => {
              const fileObj = loadedZip.file(p);
              if (!fileObj) throw new Error(`File "${p}" not found in archive.`);
              const blob = new Blob([await readZipEntryLimited(fileObj) as BlobPart]);
              return mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;
            },
            getEntryText: async (p) => {
              const fileObj = loadedZip.file(p);
              if (!fileObj) throw new Error(`File "${p}" not found in archive.`);
              return new TextDecoder().decode(await readZipEntryLimited(fileObj));
            },
            close: () => {},
          };
        }

        sessionRef.current = session;
        setArchiveSession(session);
        setEntries(session.entries);

        // Check if an initial sub-path was requested or saved in progress
        const targetPath = initialSubPath;
        if (targetPath) {
          const matched = session.entries.find((e) => e.path === targetPath && !e.isDirectory);
          if (matched && matched.isSupported) {
            void openSubEntry(matched, session, {
              page: initialPage, fraction: initialProgressFraction, mode: initialProgressMode,
            });
          }
        }
      } catch (err) {
        if (!isMounted) return;
        setArchiveError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isMounted) setLoadingArchive(false);
      }
    }

    void initArchive();

    return () => {
      isMounted = false;
      entryGenerationRef.current++;
      sessionRef.current?.close();
      sessionRef.current = null;
      revokeActiveBlobUrls();
    };
  }, [fileData, effectiveType]);

  // Open an image collection for the current folder or whole archive
  const openImageCollection = (folderFilter = currentFolder) => {
    const imagesInScope = entries.filter((e) => {
      if (e.isDirectory || e.kind !== 'image') return false;
      if (!folderFilter) return true; // root or all
      return e.path.startsWith(folderFilter ? `${folderFilter}/` : '');
    });

    if (imagesInScope.length === 0) {
      showToast('No images found in this folder.');
      return;
    }

    imagesInScope.sort((a, b) => naturalCompare(a.path, b.path));
    revokeActiveBlobUrls();
    setActiveDoc(null);
    setActiveCollection({
      folderPath: folderFilter,
      images: imagesInScope,
      currentIndex: 0,
    });
    onProgressUpdate?.(imagesInScope[0].path, 0, 0);
  };

  const closeSubReader = () => {
    entryGenerationRef.current++;
    setLoadingEntry(false);
    setActiveDoc(null);
    setActiveCollection(null);
    revokeActiveBlobUrls();
  };

  const goToImage = (index: number) => {
    if (!activeCollection) return;
    const { images, currentIndex } = activeCollection;
    const next = Math.max(0, Math.min(index, images.length - 1));
    if (next === currentIndex) return;
    setActiveCollection({ ...activeCollection, currentIndex: next });
    onProgressUpdate?.(images[next].path, next / Math.max(1, images.length - 1), next);
  };

  useImperativeHandle(ref, () => ({
    goToEntry(path, fraction = 0) {
      const entry = entryIndex.byPath.get(path);
      if (!entry) return;
      if (entry.isDirectory) {
        closeSubReader();
        setSearchQuery('');
        setCurrentFolder(entry.path);
        return;
      }
      void openSubEntry(entry, undefined, { page: 1, fraction, bookmarkFraction: fraction });
    },
    goToProgress(fraction) {
      const clamped = Math.max(0, Math.min(1, fraction));
      if (activeCollection) goToImage(Math.round(clamped * (activeCollection.images.length - 1)));
      else if (subReaderRef.current) subReaderRef.current.goToProgress(clamped);
      else {
        const viewport = subReaderStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
        if (viewport) viewport.scrollTop = clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      }
    },
    async searchEntries(query) {
      const results: ReaderSearchResult[] = [];
      for (const entry of entries) {
        if (!entry.isSupported || entry.isDirectory) continue;
        const [match] = findTextMatches(entry.path, query, 1);
        if (!match) continue;
        results.push({
          ...createTextExcerpt(entry.path, match),
          chapterId: entry.path, chapterTitle: entry.name,
          matchIndex: 0, offset: match.start,
        });
        if (results.length >= 100) break;
      }
      return results;
    },
  }));

  // Helper to load blob URL for an image entry
  const getImageBlobUrl = useCallback(
    async (entry: ZipEntryItem): Promise<string | undefined> => {
      if (!archiveSession) return undefined;
      const cached = activeBlobUrlsRef.current.get(entry.path);
      if (cached) return cached;
      const pending = pendingBlobUrlsRef.current.get(entry.path);
      if (pending) return pending;

      const generation = blobGenerationRef.current;
      const load = (async () => { try {
        const blob = await archiveSession.getEntryBlob(entry.path);
        if (generation !== blobGenerationRef.current) return undefined;
        const url = URL.createObjectURL(blob);
        activeBlobUrlsRef.current.set(entry.path, url);
        return url;
      } catch {
        return undefined;
      } finally {
        pendingBlobUrlsRef.current.delete(entry.path);
      } })();
      pendingBlobUrlsRef.current.set(entry.path, load);
      return load;
    },
    [archiveSession]
  );

  useEffect(() => {
    if (!activeCollection) return;
    const visiblePaths = new Set(activeCollection.images
      .slice(Math.max(0, activeCollection.currentIndex - 2), activeCollection.currentIndex + 3)
      .map((image) => image.path));
    for (const [path, url] of activeBlobUrlsRef.current) {
      if (!visiblePaths.has(path)) {
        URL.revokeObjectURL(url);
        activeBlobUrlsRef.current.delete(path);
      }
    }
  }, [activeCollection]);

  const currentDirectoryItems = useMemo(() => {
    if (!deferredSearchQuery) return entryIndex.byFolder.get(currentFolder) ?? [];
    return entries.filter((entry) => (entry.name.toLowerCase().includes(deferredSearchQuery) || entry.path.toLowerCase().includes(deferredSearchQuery)));
  }, [currentFolder, deferredSearchQuery, entries, entryIndex]);

  // Count images available in current directory scope
  const imagesInCurrentScope = useMemo(() => {
    const prefix = currentFolder ? `${currentFolder}/` : '';
    return entries.filter(
      (e) => !e.isDirectory && e.kind === 'image' && (!currentFolder || e.path.startsWith(prefix))
    ).length;
  }, [entries, currentFolder]);

  // Folder breadcrumbs navigation
  const breadcrumbs = useMemo(() => {
    if (!currentFolder) return [{ label: 'Root', path: '' }];
    const parts = currentFolder.split('/');
    const crumbs = [{ label: 'Root', path: '' }];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [currentFolder]);

  const archiveDisplayName = effectiveType === 'rar' ? 'RAR Archive' : 'ZIP Archive';

  // Loading state
  if (loadingArchive) {
    return (
      <div className={styles.loadingCenter}>
        <div className={styles.spinner} />
        <p>Inspecting {archiveDisplayName}…</p>
      </div>
    );
  }

  // Error state
  if (archiveError) {
    return (
      <div className={styles.loadingCenter}>
        <AlertTriangle size={40} style={{ color: 'var(--color-danger, #ef4444)' }} />
        <p>{archiveError}</p>
      </div>
    );
  }

  // =========================================================================
  // Render: Sub-Document Reader View
  // =========================================================================
  if (activeDoc) {
    const { entry, fileBuffer, chapters, location } = activeDoc;
    return (
      <div className={styles.subReaderWrapper}>
        <div className={styles.subNavBar}>
          <div className={styles.subNavBarLeft}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={closeSubReader}
              title="Return to Archive Explorer"
            >
              <ArrowLeft size={16} />
              <span>Back to Archive</span>
            </button>
            <span className={styles.subPathTitle} title={entry.path}>
              {entry.path}
            </span>
          </div>
          <div className={styles.subNavBarRight}>
            <span className={`${styles.badge} ${getBadgeClass(entry.kind)}`}>
              {entry.kind.toUpperCase()}
            </span>
          </div>
        </div>

        <div ref={subReaderStageRef} className={styles.subReaderStage} key={activeDoc.generation}>
          <Suspense fallback={<div className={styles.loadingCenter}><div className={styles.spinner} /><p>Loading reader…</p></div>}>
          {entry.kind === 'pdf' && fileBuffer ? (
            <PdfReader
              ref={registerSubReader}
              fileData={fileBuffer}
              initialPage={location.page}
              bookmarkFraction={location.bookmarkFraction}
              readingMode={readingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : entry.kind === 'epub' && fileBuffer ? (
            <EpubReader
              ref={registerSubReader}
              fileData={fileBuffer}
              settings={readerSettings}
              initialProgressFraction={location.fraction}
              onProgressUpdate={(_cfi, fraction) => onProgressUpdate?.(entry.path, fraction, 0)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
            />
          ) : entry.kind === 'djvu' && fileBuffer ? (
            <DjvuReader
              ref={registerSubReader}
              fileData={fileBuffer}
              initialPage={location.page}
              initialProgressFraction={location.fraction}
              initialProgressMode={location.mode}
              readingMode={readingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : (entry.kind === 'cbz' || entry.kind === 'cbr' || entry.kind === 'cb7') && fileBuffer ? (
            <CbzReader
              ref={registerSubReader}
              fileData={fileBuffer}
              format={entry.kind}
              initialPage={location.page}
              bookmarkFraction={location.bookmarkFraction}
              readingMode={readingMode}
              onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : chapters && chapters.length > 0 ? (
            readingMode === 'paginated' ? (
              <PaginatedReader
                ref={registerSubReader}
                chapters={chapters}
                format={entry.kind as BookFormat}
                settings={readerSettings}
                initialPageIndex={location.page - 1}
                initialProgressFraction={location.fraction}
                initialProgressMode={location.mode ?? 'scroll'}
                onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
                onToggleControls={onToggleControls}
                zoom={readerZoom}
                zoomAnchor={zoomAnchor}
              />
            ) : readingMode === 'vertical' ? (
              <DoubleSidedReader
                ref={registerSubReader}
                chapters={chapters}
                format={entry.kind as BookFormat}
                settings={readerSettings}
                initialPageIndex={location.page - 1}
                initialProgressFraction={location.fraction}
                initialProgressMode={location.mode ?? 'scroll'}
                onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
                onToggleControls={onToggleControls}
                zoom={readerZoom}
                zoomAnchor={zoomAnchor}
              />
            ) : (
              <ScrollReader
                chapters={chapters}
                format={entry.kind as BookFormat}
                settings={readerSettings}
                initialProgressFraction={location.fraction}
                onProgressUpdate={(_ch, fraction) => onProgressUpdate?.(entry.path, fraction, 0)}
                onToggleControls={onToggleControls}
                zoom={readerZoom}
                zoomAnchor={zoomAnchor}
              />
            )
          ) : (
            <div className={styles.loadingCenter}>
              <div className={styles.spinner} />
              <p>Preparing {entry.name}…</p>
            </div>
          )}
          </Suspense>
        </div>
      </div>
    );
  }

  // =========================================================================
  // Render: Image Collection Viewer Mode
  // =========================================================================
  if (activeCollection) {
    const { images, currentIndex } = activeCollection;
    const currentImg = images[currentIndex];

    return (
      <div className={styles.subReaderWrapper}>
        <div className={styles.subNavBar}>
          <div className={styles.subNavBarLeft}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={closeSubReader}
              title="Return to Archive Explorer"
            >
              <ArrowLeft size={16} />
              <span>Back to Archive</span>
            </button>
            <span className={styles.subPathTitle} title={currentImg?.path}>
              {currentImg?.path}
            </span>
          </div>

          <div className={styles.subNavBarRight}>
            <div className={styles.imageControls}>
              <button
                type="button"
                className={styles.imagePageBtn}
                aria-label="Previous image"
                disabled={currentIndex <= 0}
                onClick={() => goToImage(currentIndex - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {currentIndex + 1} / {images.length}
              </span>
              <button
                type="button"
                className={styles.imagePageBtn}
                aria-label="Next image"
                disabled={currentIndex >= images.length - 1}
                onClick={() => goToImage(currentIndex + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <span className={`${styles.badge} ${styles.badgeImage}`}>
              GALLERY
            </span>
          </div>
        </div>

        <div className={styles.subReaderStage}>
          <SingleImageDisplay
            entry={currentImg}
            getImageBlobUrl={getImageBlobUrl}
            zoom={readerZoom}
          />
        </div>
      </div>
    );
  }

  // =========================================================================
  // Render: Archive Explorer View
  // =========================================================================
  return (
    <div className={styles.container}>
      <div className={styles.explorerWrapper}>
        <div className={styles.explorerHeader}>
          {/* Archive overview card */}
          <div className={styles.archiveInfoCard}>
            <div className={styles.archiveTitleBlock}>
              <div className={styles.archiveIconBox}>
                <Layers size={24} />
              </div>
              <div>
                <h1 className={styles.archiveTitle}>
                  {book?.title || archiveDisplayName}
                </h1>
                <div className={styles.archiveStats}>
                  {entries.filter((e) => !e.isDirectory).length} files • {entries.filter((e) => e.isDirectory).length} folders
                </div>
              </div>
            </div>

            <div className={styles.archiveActions}>
              {imagesInCurrentScope > 1 && (
                <button
                  type="button"
                  className={styles.collectionBtn}
                  onClick={() => openImageCollection(currentFolder)}
                  title="Read images as sequence"
                >
                  <ImageIcon size={16} />
                  <span>Read Images ({imagesInCurrentScope})</span>
                </button>
              )}
            </div>
          </div>

          {/* Navigation row: Breadcrumbs & Search */}
          <div className={styles.toolbarRow}>
            <nav className={styles.breadcrumbs} aria-label="Folder Breadcrumbs">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <span key={crumb.path || 'root'} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {i > 0 && <span className={styles.breadcrumbSeparator}>/</span>}
                    <button
                      type="button"
                      className={`${styles.breadcrumbItem} ${isLast ? styles.breadcrumbActive : ''}`}
                      onClick={() => {
                        if (!isLast) {
                          setCurrentFolder(crumb.path);
                          setSearchQuery('');
                        }
                      }}
                    >
                      {i === 0 ? <FolderOpen size={15} /> : null}
                      <span>{crumb.label}</span>
                    </button>
                  </span>
                );
              })}
            </nav>

            <div className={styles.searchBox}>
              <Search size={16} style={{ color: 'var(--color-text-secondary, #a1a1aa)' }} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search archive files…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Entries List */}
        {currentDirectoryItems.length === 0 ? (
          <div className={styles.emptyNotice}>
            <Folder size={36} />
            <p>{searchQuery ? 'No matching files found.' : 'This folder is empty.'}</p>
          </div>
        ) : (
          <div className={styles.entriesList}>
            {currentDirectoryItems.map((entry) => (
              <div key={entry.id} className={styles.entryRow}>
                <div
                  className={styles.entryLeft}
                  onClick={() => {
                    if (entry.isDirectory) {
                      setCurrentFolder(entry.path);
                      setSearchQuery('');
                    } else if (entry.isSupported) {
                      void openSubEntry(entry);
                    } else {
                      showToast(`Cannot open unsupported file: "${entry.name}"`);
                    }
                  }}
                >
                  <div className={styles.entryIcon}>
                    {getEntryIcon(entry)}
                  </div>
                  <span className={styles.entryName} title={entry.path}>
                    {entry.name}
                  </span>
                </div>

                <div className={styles.entryRight}>
                  {!entry.isDirectory && (
                    <span className={styles.entrySize}>
                      {formatFileSize(entry.uncompressedSize)}
                    </span>
                  )}

                  <span className={`${styles.badge} ${getBadgeClass(entry.kind)}`}>
                    {entry.isDirectory ? 'FOLDER' : entry.kind.toUpperCase()}
                  </span>

                  {!entry.isDirectory && (
                    <button
                      type="button"
                      className={styles.openBtn}
                      disabled={loadingEntry}
                      onClick={() => void openSubEntry(entry)}
                    >
                      {entry.isSupported ? 'Open' : 'View'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating toast notification */}
      {toastMessage && (
        <div className={styles.toastNotice}>
          <AlertTriangle size={18} style={{ color: '#fbbf24' }} />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
});

export const ZipReader = ArchiveReader;

/** Single image viewer helper */
function SingleImageDisplay({
  entry,
  getImageBlobUrl,
  zoom = 1,
}: {
  entry: ZipEntryItem;
  getImageBlobUrl: (entry: ZipEntryItem) => Promise<string | undefined>;
  zoom?: number;
}) {
  const [url, setUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    getImageBlobUrl(entry).then((blobUrl) => {
      if (active) {
        setUrl(blobUrl);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [entry, getImageBlobUrl]);

  if (!loading && (!url || failed)) {
    return <p className={styles.loadingCenter} role="status">Unable to open this image.</p>;
  }
  if (loading) {
    return (
      <div className={styles.loadingCenter}>
        <div className={styles.spinner} />
        <p>Loading image…</p>
      </div>
    );
  }

  return (
    <div className={styles.imageViewerWrapper}>
      <img
        src={url}
        alt={entry.name}
        decoding="async"
        onError={() => setFailed(true)}
        className={styles.imageCard}
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'top center',
          transition: 'transform 0.1s ease',
        }}
      />
    </div>
  );
}

function getEntryIcon(entry: ZipEntryItem) {
  if (entry.isDirectory) {
    return <Folder size={18} className={styles.folderIcon} />;
  }

  switch (entry.kind) {
    case 'epub':
    case 'mobi':
    case 'azw3':
    case 'fb2':
      return <BookOpen size={18} className={styles.bookIcon} />;
    case 'pdf':
    case 'djvu':
      return <FileText size={18} style={{ color: '#ef4444' }} />;
    case 'cbz':
    case 'cbr':
    case 'cb7':
      return <Layers size={18} style={{ color: '#a855f7' }} />;
    case 'docx':
    case 'doc':
    case 'rtf':
      return <FileText size={18} className={styles.docIcon} />;
    case 'html':
    case 'markdown':
      return <FileCode size={18} style={{ color: '#f59e0b' }} />;
    case 'txt':
      return <FileText size={18} />;
    case 'image':
      return <ImageIcon size={18} className={styles.imageIcon} />;
    default:
      return <File size={18} />;
  }
}

function getBadgeClass(kind: ZipItemKind): string {
  switch (kind) {
    case 'epub':
      return styles.badgeEpub;
    case 'pdf':
    case 'djvu':
      return styles.badgePdf;
    case 'cbz':
    case 'cbr':
    case 'cb7':
      return styles.badgeComic;
    case 'txt':
    case 'markdown':
    case 'html':
    case 'rtf':
      return styles.badgeText;
    case 'docx':
    case 'doc':
    case 'mobi':
    case 'azw3':
    case 'fb2':
      return styles.badgeDoc;
    case 'image':
      return styles.badgeImage;
    default:
      return styles.badgeUnsupported;
  }
}
