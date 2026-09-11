import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import type { LightTableHost } from '../platform/LightTableHost';
import type {
  LightTableRecoveryListing,
  LightTableRecoveryRecord
} from '../platform/LightTableRecoveryStore';
import type { DocumentRecoveryTransitionGate } from './DocumentRecoveryTransitionGate';

const RECOVERY_ATTEMPT_PREFIX = 'lighttable:recovery-attempt:';
const recoveryAttemptKey = (recoveryId: string) => `${RECOVERY_ATTEMPT_PREFIX}${recoveryId}`;
const hasRecoveryAttempt = (recoveryId: string): boolean => {
  try {
    return localStorage.getItem(recoveryAttemptKey(recoveryId)) !== null;
  } catch {
    return false;
  }
};
const markRecoveryAttempt = (recoveryId: string): void => {
  try { localStorage.setItem(recoveryAttemptKey(recoveryId), new Date().toISOString()); } catch { /* optional */ }
};
export const clearRecoveryAttempt = (recoveryId: string): void => {
  try { localStorage.removeItem(recoveryAttemptKey(recoveryId)); } catch { /* optional */ }
};

export const newestRecoveryRecords = (
  listing: LightTableRecoveryListing
): readonly LightTableRecoveryRecord[] => {
  const seen = new Set<string>();
  return [...listing.records]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((record) => {
      if (seen.has(record.documentIdHash)) return false;
      seen.add(record.documentIdHash);
      return true;
    });
};

export const planRecoveryWorkspace = (
  listing: LightTableRecoveryListing,
  attempted: (recoveryId: string) => boolean
): { readonly records: readonly LightTableRecoveryRecord[]; readonly activeRecoveryId: string | null } => {
  const records = newestRecoveryRecords(listing)
    .filter((record) => !attempted(record.recoveryId))
    .sort((left, right) => (left.workspaceOrder ?? 0) - (right.workspaceOrder ?? 0));
  return {
    records,
    activeRecoveryId: records.find((record) => record.wasActive)?.recoveryId
      ?? records.at(-1)?.recoveryId
      ?? null
  };
};

interface RecoveredDocumentOpenResult {
  readonly ok: boolean;
  readonly value?: { readonly id: DocumentSessionId };
  readonly error?: { readonly code: string };
}

export interface StandaloneRecoveryControllerOptions {
  readonly host: LightTableHost;
  readonly documentCount: number;
  readonly transitions: DocumentRecoveryTransitionGate;
  readonly openRecoveredDocument: (
    file: File,
    record: LightTableRecoveryRecord,
    crashLoop: boolean
  ) => RecoveredDocumentOpenResult;
  readonly setOpening: (opening: boolean) => void;
}

/** Owns recovery listing, preview URLs, open admission and record disposal. */
export const useStandaloneRecoveryController = ({
  host,
  documentCount,
  transitions,
  openRecoveredDocument,
  setOpening
}: StandaloneRecoveryControllerOptions) => {
  const [listing, setListing] = useState<LightTableRecoveryListing>({ records: [], rejections: [] });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const previewsRef = useRef(previews);
  const listingRef = useRef(listing);
  const refreshRequestRef = useRef(0);
  previewsRef.current = previews;
  listingRef.current = listing;

  const refresh = useCallback(async () => {
    const request = ++refreshRequestRef.current;
    if (!host.recovery) {
      setListing({ records: [], rejections: [] });
      return;
    }
    try {
      const nextListing = await host.recovery.list();
      if (request !== refreshRequestRef.current) return;
      setListing(nextListing);
      const validIds = new Set(nextListing.records.map(({ recoveryId }) => recoveryId));
      setPreviews((current) => {
        const next = { ...current };
        let changed = false;
        for (const [recoveryId, url] of Object.entries(current)) {
          if (validIds.has(recoveryId)) continue;
          URL.revokeObjectURL(url);
          delete next[recoveryId];
          changed = true;
        }
        return changed ? next : current;
      });
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(RECOVERY_ATTEMPT_PREFIX)
          && !validIds.has(key.slice(RECOVERY_ATTEMPT_PREFIX.length))) {
          localStorage.removeItem(key);
        }
      }
    } catch (reason) {
      if (request === refreshRequestRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [host]);

  useEffect(() => {
    if (documentCount === 0) void refresh();
  }, [documentCount, refresh]);

  useEffect(() => () => {
    refreshRequestRef.current += 1;
    Object.values(previewsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const open = useCallback(async (record: LightTableRecoveryRecord) => {
    if (!host.recovery) return null;
    setOpening(true);
    setError(null);
    try {
      const entry = await host.recovery.read(record.recoveryId);
      if (!entry) throw new Error('The recovery snapshot is missing or failed validation.');
      const originalName = record.sourceName || 'Recovered document';
      const base = originalName.replace(/\.[^.]+$/, '') || 'Recovered document';
      const file = new File([entry.artifact], `${base}-recovered-lighttable.png`, {
        type: entry.record.mediaType || 'image/png'
      });
      const crashLoop = hasRecoveryAttempt(record.recoveryId);
      markRecoveryAttempt(record.recoveryId);
      const opened = await transitions.runTransition(() => {
        const result = openRecoveredDocument(file, record, crashLoop);
        if (result.ok && result.value) {
          transitions.setActiveDocument(result.value.id);
          transitions.noteCommittedTransition();
        }
        return result;
      });
      if (!opened.ok || !opened.value) {
        clearRecoveryAttempt(record.recoveryId);
        throw new Error(`Recovered work could not be opened: ${opened.error?.code ?? 'unknown'}.`);
      }
      return opened.value.id;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setOpening(false);
    }
  }, [host, openRecoveredDocument, setOpening, transitions]);

  const preview = useCallback(async (record: LightTableRecoveryRecord) => {
    if (!host.recovery) return null;
    if (previews[record.recoveryId]) return previews[record.recoveryId];
    setError(null);
    try {
      const entry = await host.recovery.read(record.recoveryId);
      if (!entry) throw new Error('The recovery preview is missing or corrupt.');
      if (!listingRef.current.records.some(({ recoveryId }) => recoveryId === record.recoveryId)) {
        return null;
      }
      const url = URL.createObjectURL(entry.artifact);
      setPreviews((current) => {
        if (!listingRef.current.records.some(({ recoveryId }) => recoveryId === record.recoveryId)) {
          URL.revokeObjectURL(url);
          return current;
        }
        const previous = current[record.recoveryId];
        if (previous) URL.revokeObjectURL(previous);
        return { ...current, [record.recoveryId]: url };
      });
      return url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, [host, previews]);

  const resolve = useCallback(async (recoveryId: string) => {
    try {
      await host.recovery?.removeRecord(recoveryId);
      clearRecoveryAttempt(recoveryId);
      setPreviews((current) => {
        const url = current[recoveryId];
        if (!url) return current;
        URL.revokeObjectURL(url);
        const next = { ...current };
        delete next[recoveryId];
        return next;
      });
      await refresh();
      return true;
    } catch (reason) {
      setError(`Recovery record was not removed: ${
        reason instanceof Error ? reason.message : String(reason)
      }`);
      return false;
    }
  }, [host, refresh]);

  return { listing, previews, error, setError, refresh, open, preview, resolve } as const;
};
