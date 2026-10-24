/** Two-page book spread reader for normalized text content. */

import { PaginatedReader, type PaginatedReaderProps } from './PaginatedReader';

type DoubleSidedReaderProps = Omit<PaginatedReaderProps, 'pagesPerSpread'>;

export function DoubleSidedReader(props: DoubleSidedReaderProps) {
  return <PaginatedReader {...props} pagesPerSpread={2} />;
}
