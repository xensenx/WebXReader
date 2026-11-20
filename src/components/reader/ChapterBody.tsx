import { memo } from 'react';

interface ChapterBodyProps {
  className: string;
  html: string;
  preserveAlignment: boolean;
}

export const ChapterBody = memo(function ChapterBody({ className, html, preserveAlignment }: ChapterBodyProps) {
  return (
    <div
      className={className}
      data-chapter-body="true"
      data-rtf-preserve-align={preserveAlignment ? 'true' : 'false'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
