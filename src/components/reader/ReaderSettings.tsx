/**
 * ReaderSettings sliding drawer for live customization of typography, themes, and reading modes.
 */

import { useEffect, useRef } from 'react';
import {
  X,
  AlignLeft,
  AlignCenter,
  AlignJustify,
  Scroll,
  BookOpen,
  Pilcrow,
  RotateCcw,
} from 'lucide-react';
import type { ThemeName } from '../../types/book';
import type {
  EffectiveReaderSettings,
  ReaderSettingsUpdate,
} from '../../hooks/useReaderSettings';
import { Button } from '../common/Button';
import { DropdownSelect } from '../common/DropdownSelect';
import styles from './ReaderSettings.module.css';

interface ReaderSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  settings: EffectiveReaderSettings;
  onUpdate: (partial: ReaderSettingsUpdate) => void;
  onUpdateTheme: (theme: ThemeName) => void;
  onReset: () => void;
  /** Whether the current format can render a double-sided spread. */
  doubleSidedSupported?: boolean;
  /** PDF keeps its fixed page geometry, but can use scroll or page mode. */
  fixedLayout?: boolean;
}

const FONT_OPTIONS = [
  { value: 'Georgia, serif', label: 'Georgia (Serif)' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman (Serif)' },
  { value: "'Palatino Linotype', Palatino, serif", label: 'Palatino (Serif)' },
  {
    value:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    label: 'System UI (Sans-Serif)',
  },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana (Sans-Serif)' },
  {
    value: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    label: 'Consolas (Monospace)',
  },
];

export function ReaderSettings({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onUpdateTheme,
  onReset,
  doubleSidedSupported = true,
  fixedLayout = false,
}: ReaderSettingsProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Reading Settings"
    >
      <div ref={panelRef} className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Reading Settings</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close settings"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.content}>
          {/* Theme */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Theme</span>
            <div className={styles.themeRow}>
              <button
                className={`${styles.themeBtn} ${styles.themeLight} ${
                  settings.theme === 'light' ? styles.themeBtnActive : ''
                }`}
                onClick={() => onUpdateTheme('light')}
                type="button"
              >
                Light
              </button>
              <button
                className={`${styles.themeBtn} ${styles.themeDark} ${
                  settings.theme === 'dark' ? styles.themeBtnActive : ''
                }`}
                onClick={() => onUpdateTheme('dark')}
                type="button"
              >
                Dark
              </button>
              <button
                className={`${styles.themeBtn} ${styles.themeSepia} ${
                  settings.theme === 'sepia' ? styles.themeBtnActive : ''
                }`}
                onClick={() => onUpdateTheme('sepia')}
                type="button"
              >
                Sepia
              </button>
            </div>
          </div>

          {/* Reading Mode */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Reading Mode</span>
            {fixedLayout && (
              <p className={styles.modeHint}>
                This document preserves its original visual layout. Adjust your reading mode and background theme below.
              </p>
            )}
            <div className={styles.modeRow} aria-label={fixedLayout ? 'Fixed-layout document' : 'Reading modes'}>
              <button
                className={`${styles.modeBtn} ${
                  settings.readingMode === 'scroll' ? styles.modeBtnActive : ''
                }`}
                onClick={() => onUpdate({ readingMode: 'scroll' })}
                type="button"
              >
                <Scroll size={18} />
                <span>Vertical Scroll</span>
              </button>
              <button
                className={`${styles.modeBtn} ${
                  settings.readingMode === 'paginated' ? styles.modeBtnActive : ''
                }`}
                onClick={() => onUpdate({ readingMode: 'paginated' })}
                type="button"
              >
                <BookOpen size={18} />
                <span>Pages</span>
              </button>
              <button
                className={`${styles.modeBtn} ${
                  settings.readingMode === 'vertical' ? styles.modeBtnActive : ''
                }`}
                onClick={() => onUpdate({ readingMode: 'vertical' })}
                disabled={!doubleSidedSupported}
                title={!doubleSidedSupported ? 'Double-sided spreads are unavailable for this format.' : undefined}
                type="button"
              >
                <Pilcrow size={18} />
                <span>Double Sided</span>
              </button>
            </div>
          </div>

          {/* Font Family */}
          {!fixedLayout && (
            <>
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Font Family</span>
                <DropdownSelect
                  className={styles.select}
                  value={settings.fontFamily}
                  onChange={(value) => onUpdate({ fontFamily: value })}
                  ariaLabel="Font Family"
                  options={FONT_OPTIONS}
                />
              </div>

              {/* Font Size */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Font Size</span>
                <div className={styles.stepperRow}>
                  <button
                    className={styles.stepperBtn}
                    onClick={() => onUpdate({ fontSize: Math.max(12, settings.fontSize - 1) })}
                    type="button"
                    aria-label="Decrease font size"
                  >
                    -
                  </button>
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                    {settings.fontSize}px
                  </span>
                  <button
                    className={styles.stepperBtn}
                    onClick={() => onUpdate({ fontSize: Math.min(36, settings.fontSize + 1) })}
                    type="button"
                    aria-label="Increase font size"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Line Height */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Line Spacing</span>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={1.2}
                    max={2.6}
                    step={0.1}
                    value={settings.lineHeight}
                    onChange={(e) => onUpdate({ lineHeight: parseFloat(e.target.value) })}
                    aria-label="Line spacing"
                  />
                  <span className={styles.sliderValue}>{settings.lineHeight.toFixed(1)}x</span>
                </div>
              </div>

              {/* Paragraph Spacing */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Paragraph Spacing</span>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0.4}
                    max={2.5}
                    step={0.1}
                    value={settings.paragraphSpacing}
                    onChange={(e) =>
                      onUpdate({ paragraphSpacing: parseFloat(e.target.value) })
                    }
                    aria-label="Paragraph spacing"
                  />
                  <span className={styles.sliderValue}>
                    {settings.paragraphSpacing.toFixed(1)}em
                  </span>
                </div>
              </div>

              {/* Letter Spacing */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Letter Spacing</span>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={-0.5}
                    max={2.5}
                    step={0.25}
                    value={settings.letterSpacing}
                    onChange={(e) =>
                      onUpdate({ letterSpacing: parseFloat(e.target.value) })
                    }
                    aria-label="Letter spacing"
                  />
                  <span className={styles.sliderValue}>
                    {settings.letterSpacing.toFixed(1)}px
                  </span>
                </div>
              </div>

              {/* Text Alignment */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Text Alignment</span>
                <div className={styles.alignRow}>
                  <button
                    className={`${styles.alignBtn} ${
                      settings.textAlign === 'left' ? styles.alignBtnActive : ''
                    }`}
                    onClick={() => onUpdate({ textAlign: 'left' })}
                    title="Left Align"
                    type="button"
                  >
                    <AlignLeft size={18} />
                  </button>
                  <button
                    className={`${styles.alignBtn} ${
                      settings.textAlign === 'center' ? styles.alignBtnActive : ''
                    }`}
                    onClick={() => onUpdate({ textAlign: 'center' })}
                    title="Center Align"
                    type="button"
                  >
                    <AlignCenter size={18} />
                  </button>
                  <button
                    className={`${styles.alignBtn} ${
                      settings.textAlign === 'justify' ? styles.alignBtnActive : ''
                    }`}
                    onClick={() => onUpdate({ textAlign: 'justify' })}
                    title="Justify Align"
                    type="button"
                  >
                    <AlignJustify size={18} />
                  </button>
                </div>
              </div>

              {/* Paragraph Indent */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>First Line Indent</span>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0}
                    max={3}
                    step={0.5}
                    value={settings.textIndent}
                    onChange={(e) => onUpdate({ textIndent: parseFloat(e.target.value) })}
                    aria-label="First line indent"
                  />
                  <span className={styles.sliderValue}>{settings.textIndent}em</span>
                </div>
              </div>

              {/* Content Max Width */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Page Width</span>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={500}
                    max={1100}
                    step={20}
                    value={settings.maxContentWidth}
                    onChange={(e) =>
                      onUpdate({ maxContentWidth: parseInt(e.target.value, 10) })
                    }
                    aria-label="Page width"
                  />
                  <span className={styles.sliderValue}>{settings.maxContentWidth}px</span>
                </div>
              </div>

              {/* Margin */}
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Margins</span>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={12}
                    max={64}
                    step={4}
                    value={settings.contentMargin}
                    onChange={(e) =>
                      onUpdate({ contentMargin: parseInt(e.target.value, 10) })
                    }
                    aria-label="Page margins"
                  />
                  <span className={styles.sliderValue}>{settings.contentMargin}px</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={onReset}
          >
            Reset Overrides
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
