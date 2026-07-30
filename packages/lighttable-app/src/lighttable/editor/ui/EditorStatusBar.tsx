import React from 'react';

export interface EditorStatusBarProps {
  status: string;
  error: boolean;
  meta: string;
  metaTitle?: string;
  reportAvailable?: boolean;
  onOpenReport?: () => void;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  status,
  error,
  meta,
  metaTitle,
  reportAvailable = false,
  onOpenReport
}) => (
  <footer className="lighttable-toolbar">
    <div
      className={`lighttable-toolbar__status${error ? ' lighttable-toolbar__status--error' : ''}`}
      title={status || undefined}
    >
      {status}
    </div>
    <div
      className={`lighttable-toolbar__meta${reportAvailable ? ' lighttable-toolbar__meta--report' : ''}`}
      role={reportAvailable ? 'button' : undefined}
      tabIndex={reportAvailable ? 0 : undefined}
      onClick={reportAvailable ? onOpenReport : undefined}
      onKeyDown={reportAvailable ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpenReport?.();
      } : undefined}
      title={metaTitle}
    >
      {meta}
    </div>
    <div aria-hidden="true" />
  </footer>
);
