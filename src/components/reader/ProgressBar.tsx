/**
 * Reading progress bar and scrubber at the bottom of the reader viewport.
 */

import { useState, useRef, type MouseEvent, type KeyboardEvent } from 'react';
import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  progress: number; // 0 to 1
  chapterTitle?: string;
  onSeek: (position: number) => void;
}

export function ProgressBar({ progress, chapterTitle, onSeek }: ProgressBarProps) {
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const calculateFraction = (e: MouseEvent<HTMLDivElement>): number => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return rect.width > 0 ? x / rect.width : 0;
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    setHoverPosition(calculateFraction(e));
  };

  const handleMouseLeave = () => {
    setHoverPosition(null);
  };

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const fraction = calculateFraction(e);
    onSeek(fraction);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onSeek(Math.min(1, progress + 0.02));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onSeek(Math.max(0, progress - 0.02));
    }
  };

  const currentPercent = Math.round(progress * 100);
  const hoverPercent = hoverPosition !== null ? Math.round(hoverPosition * 100) : null;
  const tooltipLeftPercent = hoverPosition !== null ? hoverPosition * 100 : progress * 100;

  return (
    <div
      ref={barRef}
      className={styles.container}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      role="slider"
      tabIndex={0}
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={currentPercent}
      aria-valuetext={`${currentPercent}%${chapterTitle ? ` — ${chapterTitle}` : ''}`}
    >
      <div className={styles.fill} style={{ width: `${currentPercent}%` }} />
      <div
        className={styles.tooltip}
        style={{ left: `${tooltipLeftPercent}%` }}
      >
        {hoverPercent !== null ? `${hoverPercent}%` : `${currentPercent}%`}
        {chapterTitle ? ` • ${chapterTitle}` : ''}
      </div>
    </div>
  );
}
