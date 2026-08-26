import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type EditorNotificationTone = 'progress' | 'success' | 'info' | 'warning' | 'error';

export interface EditorNotification {
  readonly id: string;
  readonly tone: EditorNotificationTone;
  readonly message: string;
  readonly createdAt: number;
  readonly durationMs: number | null;
}

const durationFor = (tone: EditorNotificationTone): number | null => {
  if (tone === 'progress') return null;
  if (tone === 'success') return 2_600;
  if (tone === 'info') return 3_500;
  if (tone === 'warning') return 5_500;
  return 7_000;
};

const statusTone = (message: string): EditorNotificationTone => {
  if (/(?:…|\.{3})$/u.test(message)) return 'progress';
  if (/\b(?:unavailable|could not|cannot|failed|canceled|cancelled|no .* found)\b/iu.test(message)) {
    return 'warning';
  }
  if (/\b(?:saved|copied|loaded|added|applied|merged|rasterized|filled|removed|placed|reset|converted|accepted|recovered|rotated|flipped|attached)\b/iu.test(message)) {
    return 'success';
  }
  return 'info';
};

/**
 * One document-scoped feedback stream. Legacy status/error callbacks remain
 * thin adapters while producers migrate to explicit notification tones.
 */
export const useEditorNotifications = (scopeKey: string) => {
  const sequenceRef = useRef(0);
  const [notifications, setNotifications] = useState<EditorNotification[]>([]);
  const [status, setStatusSignal] = useState<string | null>(null);
  const [error, setErrorSignal] = useState<string | null>(null);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);

  const publish = useCallback((
    message: string,
    tone: EditorNotificationTone,
    id = `notice-${++sequenceRef.current}`
  ) => {
    const notification: EditorNotification = {
      id,
      tone,
      message,
      createdAt: Date.now(),
      durationMs: durationFor(tone)
    };
    setNotifications((current) => [
      ...current.filter((item) => item.id !== id),
      notification
    ].slice(-3));
    return id;
  }, []);

  const setStatus = useCallback((message: string | null) => {
    setStatusSignal(message);
    if (!message) {
      dismiss('editor-status');
      return;
    }
    publish(message, statusTone(message), 'editor-status');
  }, [dismiss, publish]);

  const setError = useCallback((message: string | null) => {
    setErrorSignal(message);
    if (!message) return;
    dismiss('editor-status');
    publish(message, 'error');
  }, [dismiss, publish]);

  useLayoutEffect(() => {
    setNotifications([]);
    setStatusSignal(null);
    setErrorSignal(null);
  }, [scopeKey]);

  return { notifications, status, error, publish, dismiss, setStatus, setError };
};
