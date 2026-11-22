import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { getBookCoverSources, type BookCover } from '../../assets/covers/default-book-cover';

interface BookCoverImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  book: BookCover;
  placeholder: ReactNode;
}

export function BookCoverImage({ book, placeholder, ...props }: BookCoverImageProps) {
  const sources = getBookCoverSources(book);
  return <CoverImage key={sources[0]} sources={sources} placeholder={placeholder} {...props} />;
}

interface CoverImageProps extends Omit<BookCoverImageProps, 'book'> {
  sources: readonly string[];
}

export function CoverImage({ sources, placeholder, ...props }: CoverImageProps) {
  const [failures, setFailures] = useState(0);
  const src = sources[failures];
  return src ? <img {...props} src={src} onError={() => setFailures((count) => count + 1)} /> : placeholder;
}
