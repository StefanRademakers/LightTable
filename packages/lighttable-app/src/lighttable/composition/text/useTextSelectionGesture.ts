import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import type { FlowTextEditingSessionController } from '../../application/text/flowTextEditingSession';
import { TextSelectionGestureController } from '../../application/text/TextSelectionGestureController';
import { textSelectionForGranularity } from '../../application/text/flowTextEditing';
import { hitTestTextEditingLayout } from '../../application/text/textEditingHitTest';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerId } from '../../editor/document/documentTypes';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';

interface SelectionRenderer { textEditingLayout(layerId: LayerId): TextLayerEditingLayout | null }
interface TextSelectionBinding {
  readonly documentIdentity: string | object;
  readonly session: DocumentSession | null | undefined;
  readonly renderer: SelectionRenderer | null;
  readonly lifecycle: object;
  readonly generation: number;
}
interface TextSelectionPorts {
  getSession(): DocumentSession | null | undefined;
  getRenderer(): SelectionRenderer | null;
  getProjectedDocumentId(): string | null;
  captureScope(): { isCurrent(): boolean };
  readonly editing: Pick<FlowTextEditingSessionController, 'getSnapshot' | 'setSelection'>;
  requestFrame(callback: () => void): number;
  cancelFrame(frame: number): void;
}

/** Selection keeps its own coalescing owner; this binding supplies one captured editing/runtime target. */
export const useTextSelectionGesture = (binding: TextSelectionBinding, ports: TextSelectionPorts) => {
  const latest = useRef({ binding, ports }), mounted = useRef(false), epoch = useRef(0);
  latest.current = { binding, ports };
  const controller = useMemo(() => new TextSelectionGestureController(() => {
    const opening = latest.current, p = opening.ports, b = opening.binding, openingEpoch = epoch.current;
    const session = p.getSession(), renderer = p.getRenderer(), editing = p.editing.getSnapshot(), scope = p.captureScope();
    const isCurrent = () => {
      const now = latest.current, currentEditing = p.editing.getSnapshot(), snapshot = session?.getSnapshot();
      return Boolean(mounted.current && epoch.current === openingEpoch && session && renderer
        && now.binding.documentIdentity === b.documentIdentity && now.binding.session === b.session
        && now.binding.renderer === b.renderer && now.binding.lifecycle === b.lifecycle && now.binding.generation === b.generation
        && now.ports.editing === p.editing && p.getSession() === session && session === b.session
        && p.getRenderer() === renderer && renderer === b.renderer && snapshot?.lifecycle === 'ready'
        && snapshot.document?.id === p.getProjectedDocumentId() && editing.documentId === snapshot.document?.id
        && currentEditing.status === 'editing' && currentEditing.documentId === editing.documentId
        && currentEditing.layerId === editing.layerId && currentEditing.focusKey === editing.focusKey && scope.isCurrent());
    };
    return {
      captureScope: layerId => layerId === editing.layerId && isCurrent() ? { isCurrent } : null,
      focusAt: (layerId, point) => {
        const layout = renderer?.textEditingLayout(layerId);
        return layout ? hitTestTextEditingLayout(layout, point, Number.POSITIVE_INFINITY)?.offset ?? null : null;
      },
      rangeAt: (layerId, offset, granularity) => {
        const document = session?.getSnapshot().document, layer = document ? findDocumentLayer(document, layerId) : null;
        const layout = renderer?.textEditingLayout(layerId)?.layout;
        return layer?.type === 'text' && layer.text.source.kind === 'flow' && layout
          ? textSelectionForGranularity(layer.text.source.text, layout, offset, granularity) : null;
      },
      publishSelection: (selection, transient) => { p.editing.setSelection(selection, { transient, isCurrent }); },
      requestFrame: p.requestFrame, cancelFrame: p.cancelFrame
    };
  }), []);
  useLayoutEffect(() => {
    mounted.current = true; epoch.current++;
    return () => { mounted.current = false; epoch.current++; controller.dispose(); };
  }, [controller, binding.documentIdentity, binding.session, binding.renderer, binding.lifecycle, binding.generation, ports.editing]);
  return controller;
};
