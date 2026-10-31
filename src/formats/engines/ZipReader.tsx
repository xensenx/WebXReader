/**
 * General-purpose ZIP Archive Reader & Container Engine.
 *
 * Provides a native directory explorer for navigating archives,
 * on-demand entry decompression, and seamless delegation to
 * WebXReader's existing format readers (EPUB, PDF, DJVU, Comics,
 * reflowable documents, and image galleries).
 */

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
  lazy,
  Suspense,
} from 'react';
import JSZip from 'jszip';
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
import type { Book, Chapter } from '../../types/book';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import {
  parseZip,
  formatFileSize,
  type ZipEntryItem,
  type ZipItemKind,
} from '../../core/parsing/zip-parser';
import { naturalCompare } from '../../core/parsing/comic-archive';
import { parseTxt } from '../../core/parsing/txt-parser';
import { parseMarkdown } from '../../core/parsing/markdown-parser';
import { parseHtml } from '../../core/parsing/html-parser';
import { parseRtf } from '../../core/parsing/rtf-parser';
import { parseFb2 } from '../../core/parsing/fb2-parser';
import { parseMobi } from '../../core/parsing/mobi-parser';
import { parseAzw3 } from '../../core/parsing/azw3-parser';
import { parseDocx } from '../../core/parsing/docx-parser';
import { parseDoc } from '../../core/parsing/doc-parser';
import { parseMht } from '../../core/parsing/mht-parser';

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

export interface ZipReaderProps {
  fileData: ArrayBuffer;
  book?: Book;
  initialSubPath?: string;
  initialPage?: number;
  initialProgressFraction?: number;
  readingMode?: 'scroll' | 'paginated' | 'vertical';
  readerSettings: EffectiveReaderSettings;
  readerZoom?: number;
  zoomAnchor?: any;
  onProgressUpdate?: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
}

interface ActiveSubDocument {
  entry: ZipEntryItem;
  fileBuffer?: ArrayBuffer;
  text?: string;
  chapters?: Chapter[];
}

interface ActiveImageCollection {
  folderPath: string;
  images: ZipEntryItem[];
  currentIndex: number;
}

export const ZipReader = memo(function ZipReader({
  fileData,
  book,
  initialSubPath,
  initialPage = 1,
  initialProgressFraction: _initialProgressFraction = 0,
  readingMode = 'scroll',
  readerSettings,
  readerZoom = 1,
  zoomAnchor,
  onProgressUpdate,
  onToggleControls,
}: ZipReaderProps) {
  const [zipInstance, setZipInstance] = useState<JSZip | null>(null);
  const [entries, setEntries] = useState<ZipEntryItem[]>([]);
  const [loadingArchive, setLoadingArchive] = useState(true);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Navigation State
  const [currentFolder, setCurrentFolder] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active Reading State
  const [activeDoc, setActiveDoc] = useState<ActiveSubDocument | null>(null);
  const [activeCollection, setActiveCollection] = useState<ActiveImageCollection | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);

  // Blob URLs for image collection caching and revocation
  const activeBlobUrlsRef = useRef<Map<string, string>>(new Map());

  // Load and parse ZIP on mount
  useEffect(() => {
    let isMounted = true;
    setLoadingArchive(true);
    setArchiveError(null);

    async function initZip() {
      try {
        const [loadedZip, parsedResult] = await Promise.all([
          JSZip.loadAsync(fileData),
          parseZip(fileData, { filename: book?.originalFilename || book?.title }),
        ]);

        if (!isMounted) return;
        setZipInstance(loadedZip);
        setEntries(parsedResult.entries);

        // Check if an initial sub-path was requested or saved in progress
        const targetPath = initialSubPath;
        if (targetPath) {
          const matched = parsedResult.entries.find((e) => e.path === targetPath && !e.isDirectory);
          if (matched && matched.isSupported) {
            void openSubEntry(matched, loadedZip);
          }
        }
      } catch (err) {
        if (!isMounted) return;
        setArchiveError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isMounted) setLoadingArchive(false);
      }
    }

    void initZip();

    return () => {
      isMounted = false;
      revokeActiveBlobUrls();
    };
  }, [fileData]);

  const revokeActiveBlobUrls = () => {
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
  const openSubEntry = async (entry: ZipEntryItem, zipOverride?: JSZip) => {
    const zip = zipOverride || zipInstance;
    if (!zip) return;

    if (!entry.isSupported) {
      showToast(`Files with format ".${entry.name.split('.').pop()}" cannot be opened.`);
      return;
    }

    setLoadingEntry(true);
    try {
      const fileObj = zip.file(entry.path);
      if (!fileObj) {
        throw new Error(`File "${entry.name}" not found in archive.`);
      }

      // If it's a standalone image, open as a single-item collection or sequence
      if (entry.kind === 'image') {
        const folder = entry.path.split('/').slice(0, -1).join('/');
        const siblingImages = entries.filter(
          (e) => !e.isDirectory && e.kind === 'image' && e.path.split('/').slice(0, -1).join('/') === folder
        );
        siblingImages.sort((a, b) => naturalCompare(a.name, b.name));
        const idx = siblingImages.findIndex((e) => e.path === entry.path);

        revokeActiveBlobUrls();
        setActiveDoc(null);
        setActiveCollection({
          folderPath: folder,
          images: siblingImages,
          currentIndex: Math.max(0, idx),
        });
        onProgressUpdate?.(entry.path, 0, 0);
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
        const buffer = await fileObj.async('arraybuffer');
        setActiveCollection(null);
        setActiveDoc({
          entry,
          fileBuffer: buffer,
        });
        onProgressUpdate?.(entry.path, 0, 0);
        return;
      }

      // Reflowable text formats
      if (entry.kind === 'txt' || entry.kind === 'markdown' || entry.kind === 'html' || entry.kind === 'rtf') {
        const text = await fileObj.async('string');
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

        setActiveCollection(null);
        setActiveDoc({
          entry,
          text,
          chapters,
        });
        onProgressUpdate?.(entry.path, 0, 0);
        return;
      }

      // Complex document formats (DOCX, DOC, FB2, MOBI, AZW3, MHT)
      const buffer = await fileObj.async('arraybuffer');
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

      setActiveCollection(null);
      setActiveDoc({
        entry,
        fileBuffer: buffer,
        chapters,
      });
      onProgressUpdate?.(entry.path, 0, 0);
    } catch (err) {
      showToast(`Failed to open entry: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingEntry(false);
    }
  };

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
    setActiveDoc(null);
    setActiveCollection(null);
    revokeActiveBlobUrls();
  };

  // Helper to load blob URL for an image entry
  const getImageBlobUrl = useCallback(
    async (entry: ZipEntryItem): Promise<string | undefined> => {
      if (!zipInstance) return undefined;
      const cached = activeBlobUrlsRef.current.get(entry.path);
      if (cached) return cached;

      try {
        const fileObj = zipInstance.file(entry.path);
        if (!fileObj) return undefined;
        const blob = await fileObj.async('blob');
        const url = URL.createObjectURL(blob);
        activeBlobUrlsRef.current.set(entry.path, url);
        return url;
      } catch {
        return undefined;
      }
    },
    [zipInstance]
  );

  // Compute items displayed in current directory
  const currentDirectoryItems = useMemo(() => {
    const prefix = currentFolder ? `${currentFolder}/` : '';
    const q = searchQuery.trim().toLowerCase();

    // If searching, search across all files in the archive
    if (q) {
      return entries.filter((e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
    }

    // Otherwise show immediate children of currentFolder
    return entries.filter((e) => {
      if (currentFolder) {
        if (!e.path.startsWith(prefix) || e.path === currentFolder) return false;
        const relative = e.path.slice(prefix.length);
        return !relative.includes('/');
      } else {
        return !e.path.includes('/');
      }
    });
  }, [entries, currentFolder, searchQuery]);

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

  // Loading state
  if (loadingArchive) {
    return (
      <div className={styles.loadingCenter}>
        <div className={styles.spinner} />
        <p>Inspecting ZIP Archive…</p>
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
    const { entry, fileBuffer, chapters } = activeDoc;
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

        <div className={styles.subReaderStage}>
          <Suspense fallback={<div className={styles.loadingCenter}><div className={styles.spinner} /><p>Loading reader…</p></div>}>
          {entry.kind === 'pdf' && fileBuffer ? (
            <PdfReader
              fileData={fileBuffer}
              initialPage={initialPage}
              readingMode={readingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : entry.kind === 'epub' && fileBuffer ? (
            <EpubReader
              fileData={fileBuffer}
              settings={readerSettings}
              onProgressUpdate={(_cfi, fraction) => onProgressUpdate?.(entry.path, fraction, 0)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
            />
          ) : entry.kind === 'djvu' && fileBuffer ? (
            <DjvuReader
              fileData={fileBuffer}
              initialPage={initialPage}
              readingMode={readingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : (entry.kind === 'cbz' || entry.kind === 'cbr' || entry.kind === 'cb7') && fileBuffer ? (
            <CbzReader
              fileData={fileBuffer}
              format={entry.kind}
              initialPage={initialPage}
              readingMode={readingMode}
              onProgressUpdate={(_ch, fraction, page) => onProgressUpdate?.(entry.path, fraction, page)}
              onToggleControls={onToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : chapters && chapters.length > 0 ? (
            readingMode === 'paginated' ? (
              <PaginatedReader
                chapters={chapters}
                settings={readerSettings}
                initialPageIndex={initialPage - 1}
                onProgressUpdate={(_ch, fraction) => onProgressUpdate?.(entry.path, fraction, 0)}
                onToggleControls={onToggleControls}
                zoom={readerZoom}
                zoomAnchor={zoomAnchor}
              />
            ) : readingMode === 'vertical' ? (
              <DoubleSidedReader
                chapters={chapters}
                settings={readerSettings}
                initialPageIndex={initialPage - 1}
                onProgressUpdate={(_ch, fraction) => onProgressUpdate?.(entry.path, fraction, 0)}
                onToggleControls={onToggleControls}
                zoom={readerZoom}
                zoomAnchor={zoomAnchor}
              />
            ) : (
              <ScrollReader
                chapters={chapters}
                settings={readerSettings}
                onProgressUpdate={(_ch, fraction) => onProgressUpdate?.(entry.path, fraction, 0)}
                onToggleControls={onToggleControls}
                zoom={readerZoom}
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
                disabled={currentIndex <= 0}
                onClick={() => {
                  const nextIdx = Math.max(0, currentIndex - 1);
                  setActiveCollection({ ...activeCollection, currentIndex: nextIdx });
                  onProgressUpdate?.(images[nextIdx].path, nextIdx / images.length, nextIdx + 1);
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {currentIndex + 1} / {images.length}
              </span>
              <button
                type="button"
                className={styles.imagePageBtn}
                disabled={currentIndex >= images.length - 1}
                onClick={() => {
                  const nextIdx = Math.min(images.length - 1, currentIndex + 1);
                  setActiveCollection({ ...activeCollection, currentIndex: nextIdx });
                  onProgressUpdate?.(images[nextIdx].path, nextIdx / images.length, nextIdx + 1);
                }}
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
                  {book?.title || 'ZIP Archive'}
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

  useEffect(() => {
    let active = true;
    setLoading(true);
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

  if (loading || !url) {
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
