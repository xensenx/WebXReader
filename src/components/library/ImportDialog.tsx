/**
 * ImportDialog component for importing novel files.
 */

import { useState, useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle, BookOpen } from 'lucide-react';
import { Modal } from '../common/Modal';
import { DropZone } from '../common/DropZone';
import { Button } from '../common/Button';
import { DropdownSelect } from '../common/DropdownSelect';
import { importFile, type ImportResult } from '../../features/import/import-service';
import type { Book } from '../../types/book';
import { useSettingsContext } from '../../app/providers/SettingsContext';
import styles from './ImportDialog.module.css';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (book: Book, openDirectly?: boolean) => void | Promise<void>;
  onOpenExisting: (bookId: string) => void;
  initialFiles?: File[] | null;
}

interface BatchImportItem {
  fileName: string;
  status: 'imported' | 'duplicate' | 'failed';
  book?: Book;
  existingBookId?: string;
  message?: string;
}

export function ImportDialog({
  isOpen,
  onClose,
  onImportSuccess,
  onOpenExisting,
  initialFiles,
}: ImportDialogProps) {
  const { settings } = useSettingsContext();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicateBook, setDuplicateBook] = useState<{
    book: Book;
    existingId: string;
    pendingFile: File;
  } | null>(null);
  const [importedBook, setImportedBook] = useState<Book | null>(null);
  const [batchResults, setBatchResults] = useState<BatchImportItem[] | null>(null);
  const [autoDetectChapters, setAutoDetectChapters] = useState(true);
  const [textEncoding, setTextEncoding] = useState('auto');
  const processedInitialFilesRef = useRef<File[] | null>(null);

  const resetState = () => {
    setLoading(false);
    setStatusMessage('');
    setError(null);
    setDuplicateBook(null);
    setImportedBook(null);
    setBatchResults(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const runImport = (file: File, force = false) => importFile(file, {
    autoDetectChapters,
    textEncoding: textEncoding === 'auto' ? undefined : textEncoding,
    forceImport: force,
  });

  const processFile = async (file: File, force = false) => {
    setLoading(true);
    setError(null);
    setDuplicateBook(null);
    setImportedBook(null);
    setBatchResults(null);
    const warningThreshold = settings.importSizeWarningMB * 1024 * 1024;
    setStatusMessage(
      file.size >= warningThreshold
        ? `Large file (${(file.size / (1024 * 1024)).toFixed(1)} MB). Processing locally; this may take a moment…`
        : `Importing "${file.name}"…`
    );

    try {
      const result: ImportResult = await runImport(file, force);

      if (!result.success) {
        setError(result.error);
        setLoading(false);
        return;
      }

      if (result.isDuplicate && result.existingBookId) {
        setDuplicateBook({
          book: result.book,
          existingId: result.existingBookId,
          pendingFile: file,
        });
        setLoading(false);
        return;
      }

      setImportedBook(result.book);
      setLoading(false);
      await onImportSuccess(result.book, false);
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  };

  const processFiles = async (files: File[]) => {
    const selectedFiles = files.filter((file) => file.size > 0);
    if (selectedFiles.length === 0) return;
    if (selectedFiles.length === 1) {
      await processFile(selectedFiles[0]);
      return;
    }

    setLoading(true);
    setError(null);
    setDuplicateBook(null);
    setImportedBook(null);
    setBatchResults([]);

    const results: BatchImportItem[] = [];
    let importedCount = 0;

    for (const [index, file] of selectedFiles.entries()) {
      setStatusMessage(`Importing ${index + 1} of ${selectedFiles.length}: "${file.name}"…`);
      try {
        const result = await runImport(file);
        if (!result.success) {
          results.push({ fileName: file.name, status: 'failed', message: result.error });
        } else if (result.isDuplicate && result.existingBookId) {
          results.push({
            fileName: file.name,
            status: 'duplicate',
            book: result.book,
            existingBookId: result.existingBookId,
            message: 'Already in your library; existing copy was left unchanged.',
          });
        } else {
          importedCount += 1;
          results.push({ fileName: file.name, status: 'imported', book: result.book });
          await onImportSuccess(result.book, false);
        }
      } catch (reason) {
        results.push({
          fileName: file.name,
          status: 'failed',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      }
      setBatchResults([...results]);
    }

    setLoading(false);
    setStatusMessage(`Finished: ${importedCount} of ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} imported.`);
  };

  const handleFilesDropped = (files: File[]) => {
    void processFiles(files);
  };

  // If files were dropped onto the library before the dialog opened, process
  // the complete selection rather than silently discarding every file after
  // the first one.
  useEffect(() => {
    if (!isOpen) {
      processedInitialFilesRef.current = null;
      return;
    }
    if (
      initialFiles &&
      initialFiles.length > 0 &&
      processedInitialFilesRef.current !== initialFiles
    ) {
      // Keep the array identity as a guard. In development, React may replay
      // effects, and a replay must not import the same dropped selection a
      // second time or turn every item into a duplicate result.
      processedInitialFilesRef.current = initialFiles;
      void processFiles(initialFiles);
    }
  }, [isOpen, initialFiles]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        importedBook
          ? 'Book Imported Successfully'
          : batchResults
          ? 'Import Results'
          : duplicateBook
          ? 'Duplicate Book Detected'
          : 'Import Novel'
      }
      size="md"
    >
      <div className={styles.content}>
        {loading && (
          <div className={styles.processing}>
            <div className={styles.spinner} />
            <p className={styles.statusText}>{statusMessage}</p>
          </div>
        )}

        {!loading && error && (
          <>
            <div className={styles.errorBox}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={resetState}>
                Try Another File
              </Button>
              <Button variant="primary" onClick={handleClose}>
                Done
              </Button>
            </div>
          </>
        )}

        {!loading && !error && duplicateBook && (
          <>
            <div className={styles.warningBox}>
              <AlertTriangle size={18} />
              <div>
                <strong>A book with matching content already exists in your library:</strong>
                <p>"{duplicateBook.book.title}"</p>
              </div>
            </div>

            <p className={styles.statusText}>
              Would you like to open the existing copy, or import this as an additional copy?
            </p>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const existingId = duplicateBook.existingId;
                  handleClose();
                  onOpenExisting(existingId);
                }}
              >
                Open Existing Copy
              </Button>
              <Button
                variant="primary"
                onClick={() => processFile(duplicateBook.pendingFile, true)}
              >
                Import New Copy
              </Button>
            </div>
          </>
        )}

        {!loading && !error && batchResults && (
          <>
            <p className={styles.statusText}>{statusMessage}</p>
            <div className={styles.batchResults} role="status" aria-live="polite">
              {batchResults.map((item, index) => (
                <div key={`${index}-${item.fileName}-${item.status}`} className={styles.batchItem}>
                  <div className={styles.batchItemMain}>
                    <strong className={styles.batchFileName}>{item.fileName}</strong>
                    <span className={`${styles.batchStatus} ${styles[item.status]}`}>
                      {item.status === 'imported' ? 'Imported' : item.status === 'duplicate' ? 'Skipped duplicate' : 'Failed'}
                    </span>
                    {item.message && <span className={styles.batchMessage}>{item.message}</span>}
                  </div>
                  {item.status === 'duplicate' && item.existingBookId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleClose();
                        onOpenExisting(item.existingBookId!);
                      }}
                    >
                      Open existing
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={resetState}>Import More</Button>
              <Button variant="primary" onClick={handleClose}>Done</Button>
            </div>
          </>
        )}

        {!loading && !error && !batchResults && importedBook && (
          <>
            <div className={styles.successBox}>
              {importedBook.coverImage ? (
                <img
                  src={importedBook.coverImage}
                  alt=""
                  className={styles.successCover}
                />
              ) : (
                <div className={styles.fallbackCover}>
                  {importedBook.title.trim().charAt(0).toUpperCase()}
                </div>
              )}

              <div className={styles.successDetails}>
                <h4 className={styles.successTitle}>{importedBook.title}</h4>
                <p className={styles.successAuthor}>
                  {importedBook.author || 'Unknown Author'}
                </p>
                <p className={styles.successChapters}>
                  {importedBook.totalChapters}{' '}
                  {importedBook.totalChapters === 1 ? 'chapter' : 'chapters'} •{' '}
                  {importedBook.sourceFormat.toUpperCase()}
                </p>
              </div>
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={resetState}>
                Import Another
              </Button>
              <Button
                variant="primary"
                icon={<BookOpen size={16} />}
                onClick={() => {
                  const id = importedBook.id;
                  handleClose();
                  onOpenExisting(id);
                }}
              >
                Start Reading
              </Button>
            </div>
          </>
        )}

        {!loading && !error && !batchResults && !duplicateBook && !importedBook && (
          <>
            <div className={styles.dropzoneArea}>
              <DropZone
                onFileDrop={handleFilesDropped}
                accept=".txt,.epub,.pdf,.cbz,.md,.markdown,.html,.htm,.xhtml"
              />
            </div>

            <div className={styles.optionsSection}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={autoDetectChapters}
                  onChange={(e) => setAutoDetectChapters(e.target.checked)}
                />
                <span>Automatically detect chapters in plain text (.txt) files</span>
              </label>
              <label className={styles.optionLabel}>
                <span>Text encoding</span>
                <DropdownSelect
                  className={styles.encodingSelect}
                  value={textEncoding}
                  onChange={setTextEncoding}
                  ariaLabel="Text encoding"
                  options={[
                    { value: 'auto', label: 'Detect UTF-8 (recommended)' },
                    { value: 'utf-8', label: 'UTF-8' },
                    { value: 'windows-1252', label: 'Windows-1252' },
                    { value: 'shift_jis', label: 'Shift JIS' },
                  ]}
                />
              </label>
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
