/**
 * Drag-and-drop file import zone.
 * Shows visual feedback during drag and supports click to browse.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload } from 'lucide-react';
import styles from './DropZone.module.css';

interface DropZoneProps {
  onFileDrop: (files: File[]) => void;
  accept?: string;
  processing?: boolean;
  className?: string;
}

export function DropZone({
  onFileDrop,
  accept,
  processing = false,
  className,
}: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      dragCounter.current = 0;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFileDrop(files);
      }
    },
    [onFileDrop]
  );

  const handleClick = useCallback(() => {
    if (!processing) {
      inputRef.current?.click();
    }
  }, [processing]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        onFileDrop(files);
      }
      // Reset so the same file can be selected again
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [onFileDrop]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  const stateClass = processing
    ? styles.processing
    : dragOver
      ? styles.dragover
      : '';

  return (
    <div
      className={`${styles.dropzone} ${stateClass} ${className ?? ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label="Drop files here or click to browse"
    >
      <input
        ref={inputRef}
        type="file"
        className={styles.fileInput}
        accept={accept}
        onChange={handleFileChange}
        tabIndex={-1}
        aria-hidden="true"
        multiple
      />
      <Upload className={styles.icon} size={40} aria-hidden="true" />
      {processing ? (
        <p className={styles.text}>Processing file…</p>
      ) : dragOver ? (
        <p className={styles.text}>Drop files here</p>
      ) : (
        <>
          <p className={styles.text}>
            Drag &amp; drop files here, or <span className={styles.link}>browse</span>
          </p>
          <div className={styles.formatPills} aria-label="Supported formats">
            <span className={styles.formatPill}>EPUB</span>
            <span className={styles.formatPill}>PDF</span>
            <span className={styles.formatPill}>CBZ</span>
            <span className={styles.formatPill}>TXT</span>
            <span className={styles.formatPill}>MD</span>
            <span className={styles.formatPill}>HTML</span>
          </div>
        </>
      )}
    </div>
  );
}
