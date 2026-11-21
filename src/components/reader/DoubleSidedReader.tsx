/** Two-page book spread reader for normalized text content. */

import { forwardRef } from 'react';
import { PaginatedReader, type PaginatedReaderHandle, type PaginatedReaderProps } from './PaginatedReader';

type DoubleSidedReaderProps = Omit<PaginatedReaderProps, 'pagesPerSpread'>;

export const DoubleSidedReader = forwardRef<PaginatedReaderHandle, DoubleSidedReaderProps>(
  function DoubleSidedReader(props, ref) {
    return <PaginatedReader {...props} ref={ref} pagesPerSpread={2} />;
  },
);
