import React, { useCallback, useEffect, useRef } from 'react';
import { ButtonBase } from '../../../ui/ButtonBase';
import type { EditorNotification } from '../notifications/useEditorNotifications';

interface EditorToastProps {
  readonly notification: EditorNotification;
  readonly onDismiss: (id: string) => void;
}

const EditorToast: React.FC<EditorToastProps> = ({ notification, onDismiss }) => {
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef(notification.durationMs);
  const startedAtRef = useRef(0);

  const pause = useCallback(() => {
    if (timerRef.current === null || remainingRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
  }, []);

  const resume = useCallback(() => {
    if (timerRef.current !== null || remainingRef.current === null) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(
      () => onDismiss(notification.id),
      remainingRef.current
    );
  }, [notification.id, onDismiss]);

  useEffect(() => {
    remainingRef.current = notification.durationMs;
    resume();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [notification.createdAt, notification.durationMs, resume]);

  return (
    <article
      className={`lighttable-toast lighttable-toast--${notification.tone}`}
      role={notification.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      <span className="lighttable-toast__indicator" aria-hidden="true" />
      <span className="lighttable-toast__message">{notification.message}</span>
      <ButtonBase
        type="button"
        className="lighttable-toast__close"
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={() => onDismiss(notification.id)}
      >
        ×
      </ButtonBase>
    </article>
  );
};

export const EditorToastViewport: React.FC<{
  readonly notifications: readonly EditorNotification[];
  readonly onDismiss: (id: string) => void;
}> = ({ notifications, onDismiss }) => notifications.length ? (
  <section className="lighttable-toast-viewport" aria-label="Notifications">
    {notifications.map((notification) => (
      <EditorToast
        key={notification.id}
        notification={notification}
        onDismiss={onDismiss}
      />
    ))}
  </section>
) : null;
