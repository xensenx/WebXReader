import { Layers } from 'lucide-react';
import type { ImgHTMLAttributes } from 'react';
import { getBookCoverSources, type BookCover } from '../../assets/covers/default-book-cover';
import { CoverImage } from '../library/BookCoverImage';
import styles from './SeriesView.module.css';

interface SeriesCoverProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  customCover?: string;
  firstVolume?: BookCover;
  decorative?: boolean;
}

export function SeriesCover({ customCover, firstVolume, decorative, className, ...props }: SeriesCoverProps) {
  const fallback = firstVolume ? getBookCoverSources(firstVolume) : [];
  const sources = customCover ? [customCover, ...fallback.filter((source) => source !== customCover)] : fallback;
  const placeholder = decorative ? null : <div className={`${className ?? ''} ${styles.coverFallback}`} aria-hidden="true"><Layers size={28} /></div>;

  return <CoverImage key={JSON.stringify(sources)} sources={sources} placeholder={placeholder} className={className} {...props} />;
}
