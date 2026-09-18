import React from 'react';
import { ToastViewport } from '@mediavibe/ui';
import type { EditorNotification } from '../notifications/useEditorNotifications';

export const EditorToastViewport: React.FC<{
  readonly notifications: readonly EditorNotification[];
  readonly onDismiss: (id: string) => void;
}> = ({ notifications, onDismiss }) => (
  <ToastViewport notifications={notifications} onDismiss={onDismiss}
    style={{ position: 'absolute', bottom: 'calc(var(--lt-layout-statusbar-height) + 14px)' }} />
);
