import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  buildTextEditingOverlay,
  type TextEditingOverlay
} from '@lighttable/text-rendering';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { TextInputBridge, type TextInputFormatCommand } from '../../editor/ui/TextInputBridge';
import type {
  FlowTextEditingSessionController,
  FlowTextEditingSnapshot
} from './flowTextEditingSession';
import type { ParagraphStylePatch, TextStylePatch } from './flowTextFormatting';
import { buildPathTextEditingOverlay } from '../../text/rendering/pathTextEditingOverlay';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import {
  beginTextInteractionTrace,
  immediateTextInteractionOverlayEnabled,
  recordTextInteractionTrace,
  type TextInteractionTraceIdentity
} from './textInteractionPerformanceTrace';
import { buildProvisionalTextEditingLayout } from './provisionalTextEditingLayout';

export interface FlowTextEditingRuntimeRenderer {
  textEditingLayout(layerId: LayerId): TextLayerEditingLayout | null;
  setTextEditingOverlay(
    overlay: TextEditingOverlay | null,
    caretVisible?: boolean,
    trace?: TextInteractionTraceIdentity | null
  ): void;
  beginTextInput(layerId: LayerId, startedAt?: number): boolean;
}

interface FlowTextEditingRuntimeProps {
  readonly controller: FlowTextEditingSessionController;
  readonly document: ImageDocument | null;
  readonly renderer: FlowTextEditingRuntimeRenderer | null;
  readonly active: boolean;
  /** Rebuild overlay geometry only when the renderer publishes a fresh layout. */
  readonly layoutPublicationRevision: number;
}

const editingOverlayFor = (
  editing: FlowTextEditingSnapshot,
  presentation: TextLayerEditingLayout | null,
  document: ImageDocument | null,
  currentText: string
) => {
  if (editing.status !== 'editing' || !editing.layerId || !presentation) return null;
  const layer = document ? findDocumentLayer(document, editing.layerId) : null;
  const frame = layer?.type === 'text'
    && layer.text.source.kind === 'flow'
    && layer.text.source.layout.mode === 'paragraph'
    ? layer.text.source.layout.frame
    : null;
  const composition = editing.compositionRange ? {
    start: Math.min(editing.compositionRange.anchor, editing.compositionRange.focus),
    end: Math.max(editing.compositionRange.anchor, editing.compositionRange.focus)
  } : null;
  if (presentation.path) {
    return buildPathTextEditingOverlay({
      layerId: editing.layerId,
      layout: presentation.layout,
      pathLayout: presentation.path.pathLayout,
      table: presentation.path.table,
      projection: presentation.path.projection,
      localToDocument: presentation.localToDocument,
      anchor: editing.selection.anchor,
      focus: editing.selection.focus,
      caretAffinity: editing.caretAffinity,
      composition
    });
  }
  const layout = presentation.sourceText !== null
    && presentation.writingMode === 'horizontal-tb'
    ? buildProvisionalTextEditingLayout(
      presentation.layout,
      presentation.sourceText,
      currentText,
      [editing.selection.anchor, editing.selection.focus],
      editing.caretAffinity
    )
    : presentation.layout;
  return buildTextEditingOverlay({
    layerId: editing.layerId,
    layout,
    localToDocument: presentation.localToDocument,
    anchor: editing.selection.anchor,
    focus: editing.selection.focus,
    caretAffinity: editing.caretAffinity,
    composition,
    frame
  });
};

/**
 * Isolated high-frequency text interaction island.
 *
 * Caret, selection, IME bridge and GPU overlay updates subscribe directly to
 * the editing controller. They therefore do not re-render the editor shell.
 */
export const FlowTextEditingRuntime: React.FC<FlowTextEditingRuntimeProps> = ({
  controller,
  document,
  renderer,
  active,
  layoutPublicationRevision
}) => {
  const interactionContext = useRef({ document, renderer });
  const pendingInteractionTrace = useRef<TextInteractionTraceIdentity | null>(null);
  interactionContext.current = { document, renderer };
  const subscribeAtAnimationFrame = useMemo(() => (
    notify: () => void
  ) => {
    let frame: number | null = null;
    let previous = controller.getSnapshot();
    const unsubscribe = controller.subscribe(() => {
      const next = controller.getSnapshot();
      const selectionChanged = previous.status === 'editing'
        && next.status === 'editing'
        && previous.layerId === next.layerId
        && (previous.selection.anchor !== next.selection.anchor
          || previous.selection.focus !== next.selection.focus
          || previous.caretAffinity !== next.caretAffinity
          || previous.compositionRange !== next.compositionRange);
      previous = next;
      if (selectionChanged && next.layerId) {
        const trace = beginTextInteractionTrace();
        recordTextInteractionTrace(trace, 'controller');
        const current = interactionContext.current;
        const presentation = current.renderer?.textEditingLayout(next.layerId) ?? null;
        const overlayStartedAt = performance.now();
        const immediateOverlay = editingOverlayFor(
          next,
          presentation,
          current.document,
          controller.text()
        );
        recordTextInteractionTrace(trace, 'overlay-build', overlayStartedAt);
        if (immediateOverlay) {
          if (immediateTextInteractionOverlayEnabled()) {
            current.renderer?.setTextEditingOverlay(immediateOverlay, true, trace);
            pendingInteractionTrace.current = null;
          } else {
            pendingInteractionTrace.current = trace;
          }
        }
      }
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        notify();
      });
    });
    return () => {
      unsubscribe();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [controller]);
  const editing = useSyncExternalStore(
    subscribeAtAnimationFrame,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const presentation = editing.status === 'editing' && editing.layerId
    ? renderer?.textEditingLayout(editing.layerId) ?? null
    : null;
  const currentText = editing.status === 'editing' ? controller.text() : '';
  const overlay = useMemo(
    () => editingOverlayFor(editing, presentation, document, currentText),
    [currentText, document, editing, layoutPublicationRevision, presentation]
  );

  useEffect(() => () => renderer?.setTextEditingOverlay(null), [renderer]);
  useEffect(() => {
    if (!renderer || !active || !overlay) {
      renderer?.setTextEditingOverlay(null);
      return undefined;
    }
    let caretVisible = true;
    const interactionTrace = pendingInteractionTrace.current;
    pendingInteractionTrace.current = null;
    renderer.setTextEditingOverlay(overlay, caretVisible, interactionTrace);
    const blink = window.setInterval(() => {
      caretVisible = !caretVisible;
      renderer.setTextEditingOverlay(overlay, caretVisible);
    }, 530);
    return () => { window.clearInterval(blink); };
  }, [active, overlay, renderer]);

  if (editing.status !== 'editing' || !editing.layerId) return null;
  const layerId = editing.layerId;
  const runMeasured = (mutation: () => boolean) => {
    const startedAt = performance.now();
    if (mutation()) renderer?.beginTextInput(layerId, startedAt);
  };
  const format = (command: TextInputFormatCommand) => {
    const projection = controller.formatProjection();
    if (!projection) return;
    const style = projection.style.kind === 'value' ? projection.style.value : null;
    const paragraph = projection.paragraph.kind === 'value' ? projection.paragraph.value : null;
    let stylePatch: TextStylePatch = {};
    let paragraphPatch: ParagraphStylePatch = {};
    if (command === 'toggle-bold') stylePatch = { syntheticBold: !(style?.syntheticBold ?? false) };
    else if (command === 'toggle-italic') stylePatch = { syntheticItalic: !(style?.syntheticItalic ?? false) };
    else if (command === 'toggle-underline') stylePatch = { underline: !(style?.underline ?? false) };
    else if (command === 'increase-size' || command === 'decrease-size') {
      stylePatch = { fontSize: Math.max(1, Math.min(1296, (style?.fontSize ?? 16)
        + (command === 'increase-size' ? 1 : -1))) };
    } else if (command === 'increase-tracking' || command === 'decrease-tracking') {
      stylePatch = { tracking: Math.max(-1000, Math.min(1000, (style?.tracking ?? 0)
        + (command === 'increase-tracking' ? 20 : -20))) };
    } else if (command === 'baseline-up' || command === 'baseline-down') {
      stylePatch = { baselineShift: Math.max(-100000, Math.min(100000, (style?.baselineShift ?? 0)
        + (command === 'baseline-up' ? 1 : -1))) };
    } else {
      const delta = command === 'increase-leading' ? 1 : -1;
      const current = paragraph?.lineHeight ?? { kind: 'normal' as const };
      const lineHeight: NonNullable<ParagraphStylePatch['lineHeight']> = current.kind === 'absolute'
        ? { kind: 'absolute', value: Math.max(1, current.value + delta) }
        : current.kind === 'multiple'
          ? { kind: 'multiple', value: Math.max(0.01, current.value + delta * 0.1) }
          : { kind: 'absolute', value: Math.max(1, (style?.fontSize ?? 16) * 1.2 + delta) };
      paragraphPatch = { lineHeight };
    }
    const startedAt = performance.now();
    if (!controller.beginFormatting()) return;
    const changed = controller.format(stylePatch, paragraphPatch);
    controller.endFormatting();
    if (changed) renderer?.beginTextInput(layerId, startedAt);
  };
  return (
    <TextInputBridge
      label={`Edit ${document
        ? findDocumentLayer(document, layerId)?.name ?? 'text layer'
        : 'text layer'}`}
      text={controller.text()}
      selectionStart={Math.min(editing.selection.anchor, editing.selection.focus)}
      selectionEnd={Math.max(editing.selection.anchor, editing.selection.focus)}
      focusKey={editing.focusKey}
      selectedText={controller.selectedText()}
      onEdit={(command) => {
        runMeasured(() => command.kind === 'insert'
          ? controller.insert(command.text)
          : controller.delete(command.direction, command.unit));
      }}
      onNavigate={(command, extend) => {
        if (command === 'select-all') {
          controller.selectAll();
        } else if (command === 'backward' || command === 'forward') {
          const layout = renderer?.textEditingLayout(layerId)?.layout;
          if (layout) controller.navigateLayoutHorizontal(layout, command, extend);
          else controller.navigate(command, { extend });
        } else if (command === 'word-backward' || command === 'word-forward') {
          controller.navigate(
            command === 'word-backward' ? 'backward' : 'forward',
            { extend, unit: 'word' }
          );
        } else if (command === 'document-start') {
          controller.moveToBoundary('start', extend);
        } else if (command === 'document-end') {
          controller.moveToBoundary('end', extend);
        } else {
          const layout = renderer?.textEditingLayout(layerId)?.layout;
          if (layout) controller.navigateLayout(layout, command, extend);
          else controller.navigateLogicalLine(command, extend);
        }
        const next = controller.getSnapshot();
        return {
          start: Math.min(next.selection.anchor, next.selection.focus),
          end: Math.max(next.selection.anchor, next.selection.focus)
        };
      }}
      onFormat={format}
      onCompositionStart={() => { controller.compositionStart(); }}
      onCompositionUpdate={(text) => { runMeasured(() => controller.compositionUpdate(text)); }}
      onCompositionEnd={(text) => {
        runMeasured(() => controller.compositionUpdate(text));
        controller.compositionEnd(text);
      }}
      onPaste={(text) => { runMeasured(() => controller.paste(text)); }}
      onCut={() => { runMeasured(() => controller.delete('backward')); }}
      onCheckpoint={() => { controller.checkpoint(); }}
      onCommit={() => { controller.finish(); }}
      onCancel={() => {
        if (!controller.cancelComposition()) controller.finish();
      }}
    />
  );
};
