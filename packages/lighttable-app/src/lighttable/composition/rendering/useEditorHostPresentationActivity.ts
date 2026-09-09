import { useEffect, useRef, useState } from 'react';
import type { LightTableHostPresentationService } from '../../../platform/LightTableHost';

const pageIsVisible = () => document.visibilityState !== 'hidden';

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
): boolean => {
  const [hostActive, setHostActive] = useState(pageIsVisible);
  const hostActiveRef = useRef(hostActive);
  const onDeactivateRef = useRef(onDeactivate);
  onDeactivateRef.current = onDeactivate;

  const publish = (active: boolean) => {
    if (hostActiveRef.current === active) return;
    if (!active) onDeactivateRef.current?.();
    hostActiveRef.current = active;
    setHostActive(active);
  };

  useEffect(() => {
    if (source) {
      let current = true;
      let publicationRevision = 0;
      const refresh = () => {
        const requestedAtRevision = publicationRevision;
        void source.current().then((active) => {
          if (current && publicationRevision === requestedAtRevision) publish(active);
        }).catch(() => undefined);
      };
      const unsubscribe = source.subscribe((active) => {
        publicationRevision += 1;
        if (current) publish(active);
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
    const handleVisibility = () => publish(pageIsVisible());
    const handleBlur = () => publish(false);
    const handleFocus = () => publish(pageIsVisible());
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, [source]);

  return editorActive && hostActive;
};
