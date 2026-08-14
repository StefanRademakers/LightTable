import React from 'react';
import { lightTableIcon } from '../../../assets/icons';

export interface EditorStatusBarProps {
  status: string;
  error: boolean;
  meta: string;
  metaTitle?: string;
  reportAvailable?: boolean;
  onOpenReport?: () => void;
  leftDockAvailable?: boolean;
  leftDockVisible?: boolean;
  rightDockAvailable?: boolean;
  rightDockVisible?: boolean;
  onToggleLeftDock?: () => void;
  onToggleRightDock?: () => void;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  status,
  error,
  meta,
  metaTitle,
  reportAvailable = false,
  onOpenReport,
  leftDockAvailable = false,
  leftDockVisible = false,
  rightDockAvailable = false,
  rightDockVisible = false,
  onToggleLeftDock,
  onToggleRightDock
}) => (
  <footer className="lighttable-toolbar">
    <button
      className="lighttable-toolbar__dock-toggle"
      type="button"
      disabled={!leftDockAvailable}
      aria-label={`${leftDockVisible ? 'Hide' : 'Show'} left panels`}
      aria-pressed={leftDockVisible}
      title={`${leftDockVisible ? 'Hide' : 'Show'} left panels`}
      onClick={onToggleLeftDock}
    >
      <img
        src={lightTableIcon(`column_left_${leftDockVisible ? 'active' : 'inactive'}.png`)}
        alt=""
      />
    </button>
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
    <button
      className="lighttable-toolbar__dock-toggle"
      type="button"
      disabled={!rightDockAvailable}
      aria-label={`${rightDockVisible ? 'Hide' : 'Show'} right panels`}
      aria-pressed={rightDockVisible}
      title={`${rightDockVisible ? 'Hide' : 'Show'} right panels`}
      onClick={onToggleRightDock}
    >
      <img
        src={lightTableIcon(`column_right_${rightDockVisible ? 'active' : 'inactive'}.png`)}
        alt=""
      />
    </button>
  </footer>
);
