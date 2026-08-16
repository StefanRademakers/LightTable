import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '../ui/ActionButton';
import {
  describeUiInspectionTarget,
  isUiInspectionGesture,
  OPEN_UI_STYLE_GUIDE_EVENT,
  type UiInspectionTarget
} from '../ui/uiInspection';
import { UiStyleGuideDialog } from './UiStyleGuideDialog';

interface UiInspectorHudState {
  readonly index: number;
  readonly count: number;
}

/**
 * Development-only bridge between runtime metadata and the Style Guide.
 * It observes the DOM and adds temporary attributes; it never reads or mutates
 * editor, document, tool, panel or application state.
 */
export function UiInspectorHost() {
  const [styleGuideOpen, setStyleGuideOpen] = useState(false);
  const [inspection, setInspection] = useState<UiInspectionTarget | null>(null);
  const [hud, setHud] = useState<UiInspectorHudState | null>(null);
  const inspectedElementRef = useRef<HTMLElement | null>(null);
  const matchesRef = useRef<HTMLElement[]>([]);

  const clearMarkers = useCallback(() => {
    document.querySelectorAll<HTMLElement>('[data-suite-inspector-match], [data-suite-inspector-current]')
      .forEach((element) => {
        delete element.dataset.suiteInspectorMatch;
        delete element.dataset.suiteInspectorCurrent;
      });
    matchesRef.current = [];
  }, []);

  const activateMatch = useCallback((requestedIndex: number) => {
    const matches = matchesRef.current.filter((element) => element.isConnected);
    if (!matches.length) {
      setHud({ index: 0, count: 0 });
      return;
    }
    const index = (requestedIndex + matches.length) % matches.length;
    matches.forEach((element, itemIndex) => {
      if (itemIndex === index) element.dataset.suiteInspectorCurrent = 'true';
      else delete element.dataset.suiteInspectorCurrent;
    });
    setHud({ index, count: matches.length });
    matches[index]?.scrollIntoView({ block: 'center', inline: 'center' });
  }, []);

  const showInApp = useCallback((controlId: string | null, auditId?: string) => {
    clearMarkers();
    const auditTarget = auditId
      ? document.querySelector<HTMLElement>(`[data-suite-audit-id="${auditId}"]`)
      : null;
    const matches = controlId
      ? [...document.querySelectorAll<HTMLElement>('[data-suite-control]')]
        .filter((element) => element.dataset.suiteControl === controlId)
        .filter((element) => !element.closest('.lighttable-ui-guide, [data-ui-inspector]'))
        .filter((element) => element.getClientRects().length > 0)
      : auditTarget ? [auditTarget]
        : inspectedElementRef.current?.isConnected ? [inspectedElementRef.current] : [];
    if (auditTarget) {
      inspectedElementRef.current = auditTarget;
      const nextInspection = describeUiInspectionTarget(auditTarget);
      if (nextInspection) setInspection(nextInspection);
    }
    matches.forEach((element) => { element.dataset.suiteInspectorMatch = 'true'; });
    matchesRef.current = matches;
    setStyleGuideOpen(false);
    window.requestAnimationFrame(() => activateMatch(0));
  }, [activateMatch, clearMarkers]);

  const closeInspector = useCallback(() => {
    clearMarkers();
    inspectedElementRef.current = null;
    setInspection(null);
    setHud(null);
  }, [clearMarkers]);

  useEffect(() => {
    const openStyleGuide = () => setStyleGuideOpen(true);
    const inspectControl = (event: MouseEvent) => {
      if (!isUiInspectionGesture(event)) return;
      const nextInspection = describeUiInspectionTarget(event.target);
      if (!nextInspection) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearMarkers();
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-suite-control]')
          ?? event.target.closest<HTMLElement>(
            'button, select, input:not([type="hidden"]), [role="button"], [role="slider"], [role="menuitem"]'
          )
        : null;
      inspectedElementRef.current = target;
      if (target) {
        target.dataset.suiteInspectorMatch = 'true';
        target.dataset.suiteInspectorCurrent = 'true';
      }
      setHud(null);
      setInspection(nextInspection);
      setStyleGuideOpen(true);
    };
    window.addEventListener(OPEN_UI_STYLE_GUIDE_EVENT, openStyleGuide);
    window.addEventListener('click', inspectControl, true);
    return () => {
      window.removeEventListener(OPEN_UI_STYLE_GUIDE_EVENT, openStyleGuide);
      window.removeEventListener('click', inspectControl, true);
      clearMarkers();
    };
  }, [clearMarkers]);

  return (
    <>
      <UiStyleGuideDialog open={styleGuideOpen} onClose={() => setStyleGuideOpen(false)}
        inspection={inspection} onShowInApp={showInApp} />
      {hud && !styleGuideOpen ? (
        <aside className="lighttable-ui-inspector" data-ui-inspector aria-label="UI control inspector">
          <strong>{inspection?.controlId ?? inspection?.label ?? 'Unregistered control'}</strong>
          <span>{hud.count ? `${hud.index + 1} / ${hud.count} live` : 'No live instances'}</span>
          <ActionButton size="compact" disabled={hud.count < 2}
            onClick={() => activateMatch(hud.index - 1)}>Previous</ActionButton>
          <ActionButton size="compact" disabled={hud.count < 2}
            onClick={() => activateMatch(hud.index + 1)}>Next</ActionButton>
          <ActionButton size="compact" onClick={() => setStyleGuideOpen(true)}>Style Guide</ActionButton>
          <ActionButton size="compact" onClick={closeInspector}>Exit</ActionButton>
        </aside>
      ) : null}
    </>
  );
}
