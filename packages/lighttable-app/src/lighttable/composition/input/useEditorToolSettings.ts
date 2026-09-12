import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { EditorSession } from '../../editor/session/editorSession';
import { EditorToolSettings } from '../../application/input/EditorToolSettings';

/** Uses the existing combined-session adapter; tab changes reset digits, never shared defaults. */
export const useEditorToolSettings = (documentId: string, updateSession: Dispatch<SetStateAction<EditorSession>>) => {
  const latest = useRef(updateSession), mounted = useRef(false); latest.current = updateSession;
  const owner = useMemo(() => new EditorToolSettings(update => {
    if (!mounted.current) return;
    latest.current(current => mounted.current ? { ...current, ...update(current) } : current);
  }), []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.clearPercentInput(); }; }, [owner]);
  useLayoutEffect(owner.clearPercentInput, [owner, documentId]);
  return owner;
};
