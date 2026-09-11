import { useEffect, useRef, useState } from 'react';
import type {
  LightTableHostPresentationService,
  LightTableHostPresentationState
} from '../../../platform/LightTableHost';

const pageIsVisible = () => document.visibilityState !== 'hidden';
const initialPresentationState = (): LightTableHostPresentationState => (
  pageIsVisible() ? 'active' : 'hidden'
);

export interface EditorHostPresentationActivity {
  readonly active: boolean;
  readonly retainResidentPresentation: boolean;
}

/**
 * Projects host foreground state into renderer activity.
 *
 * Initialization deliberately uses Page Visibility rather than `hasFocus()`:
 * automated and embedded hosts can own a visible surface before the OS grants
 * keyboard focus. Subsequent blur/focus events are authoritative transitions.
 */
export const useEditorHostPresentationActivity = (
  editorActive: boolean,
  source?: LightTableHostPresentationService,
  onDeactivate?: () => void
): EditorHostPresentationActivity => {
  const [hostState, setHostState] = useState(initialPresentationState);
  const hostStateRef = useRef(hostState);
  const onDeactivateRef = useRef(onDeactivate);
  onDeactivateRef.current = onDeactivate;

  const publish = (state: LightTableHostPresentationState) => {
    if (hostStateRef.current === state) return;
    if (hostStateRef.current === 'active' && state !== 'active') {
      onDeactivateRef.current?.();
    }
    hostStateRef.current = state;
    setHostState(state);
  };

  useEffect(() => {
    if (source) {
      let current = true;
      let publicationRevision = 0;
      const refresh = () => {
        const requestedAtRevision = publicationRevision;
        void source.current().then((state) => {
          if (current && publicationRevision === requestedAtRevision) publish(state);
        }).catch(() => undefined);
      };
      const unsubscribe = source.subscribe((state) => {
        publicationRevision += 1;
        if (current) publish(state);
      });
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
      refresh();
      return () => {
        current = false;
        unsubscribe();
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', refresh);
      };
    }
    const handleVisibility = () => publish(pageIsVisible() ? 'active' : 'hidden');
    const handleBlur = () => publish('blurred');
    const handleFocus = () => publish(pageIsVisible() ? 'active' : 'hidden');
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [source]);

  return {
    active: editorActive && hostState === 'active',
    retainResidentPresentation: editorActive && hostState === 'blurred'
  };
};
