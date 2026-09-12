import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentMutationController } from '../../application/documents/useDocumentMutationController';
import { TextLayerMoveGestureController } from '../../application/text/TextLayerMoveGestureController';
import { ParagraphFrameResizeController } from '../../application/text/ParagraphFrameResizeController';
import { PathTextHandleController } from '../../application/text/PathTextHandleController';
import { captureTextGeometryRealization, captureTextGeometryScope, textGeometryDocument,
  textGeometryEditingLayer, type TextGeometrySource } from './captureTextGeometryRealization';

interface TextGeometryBinding {
  readonly documentIdentity: object | string;
  readonly session: ReturnType<TextGeometrySource['getSession']>;
  readonly renderer: ReturnType<TextGeometrySource['getRenderer']>;
  readonly lifecycle: object;
  readonly generation: number;
}
interface TextGeometryPorts extends TextGeometrySource {
  readonly documentMutations: Pick<DocumentMutationController, 'begin'>;
}

/** Composes existing gesture owners and retires only geometry before later editing-reset effects. */
export const useTextGeometryGestures = (binding: TextGeometryBinding, ports: TextGeometryPorts) => {
  const latest = useRef({ binding, ports }), mounted = useRef(false), epoch = useRef(0);
  latest.current = { binding, ports };
  const gestures = useMemo(() => {
    const dependencies = () => {
      const opening = latest.current, openingEpoch = epoch.current;
      const source: TextGeometrySource = { ...opening.ports, captureScope: () => {
        const scope = opening.ports.captureScope();
        return { isCurrent: () => mounted.current && epoch.current === openingEpoch
          && latest.current.binding.documentIdentity === opening.binding.documentIdentity
          && latest.current.binding.session === opening.binding.session
          && latest.current.binding.renderer === opening.binding.renderer
          && latest.current.binding.lifecycle === opening.binding.lifecycle
          && latest.current.binding.generation === opening.binding.generation
          && latest.current.ports.editing === opening.ports.editing
          && latest.current.ports.documentMutations === opening.ports.documentMutations
          && opening.ports.getSession() === opening.binding.session
          && opening.ports.getRenderer() === opening.binding.renderer && scope.isCurrent() };
      } };
      return {
        getDocument: () => textGeometryDocument(source), getEditingLayerId: () => textGeometryEditingLayer(source),
        documentMutations: opening.ports.documentMutations,
        captureScope: (layerId: Parameters<typeof captureTextGeometryScope>[1]) => captureTextGeometryScope(source, layerId),
        captureRealization: (layerId: Parameters<typeof captureTextGeometryRealization>[1]) => {
          const captured = captureTextGeometryRealization(source, layerId);
          return captured ? { localToDocument: captured.layout.localToDocument, isCurrent: captured.isCurrent } : null;
        },
        getRealization: (layerId: Parameters<typeof captureTextGeometryRealization>[1]) => {
          const captured = captureTextGeometryRealization(source, layerId), path = captured?.layout.path;
          return captured && path ? { table: path.table, projection: path.projection,
            localToDocument: captured.layout.localToDocument, isCurrent: captured.isCurrent } : null;
        }
      };
    };
    return { move: new TextLayerMoveGestureController(dependencies),
      frame: new ParagraphFrameResizeController(dependencies), path: new PathTextHandleController(dependencies) };
  }, []);
  useLayoutEffect(() => {
    mounted.current = true; epoch.current++;
    return () => {
      mounted.current = false; epoch.current++;
      gestures.move.cancel(); gestures.frame.cancel(); gestures.path.cancel();
    };
  }, [gestures, binding.documentIdentity, binding.session, binding.renderer, binding.lifecycle, binding.generation,
    ports.editing, ports.documentMutations]);
  return gestures;
};
