import type { DocumentSession } from '../documents/documentSession';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../../editor/document/layerTree';
import type { BrushSettings } from '../../editor/session/editorSession';
import type { PaintBrushStrokePlan } from '../../editor/tools/paint/sampledBrushTypes';
import { paintTargetSourceToDocument } from '../../editor/tools/paint/paintCoordinates';
import type { SelectionSessionController } from '../tools/selection/useSelectionSessionController';
import type { PaintSessionController } from '../tools/paint/usePaintSessionController';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { LightTableGestureKind, LightTableGestureSample } from './lightTableCommandContract';
import { parseAutomationBrushSettings, parseAutomationPaintOperator } from './lightTableCommandValidation';
import { AutomationLayerTranslationGesture, type AutomationGestureScope } from './AutomationLayerTranslationGesture';

interface ScopeHost {
  getCurrentSession(): DocumentSession | undefined;
  getCurrentRenderer(): object | null;
  captureRendererScope(): AutomationGestureScope;
}
export interface MountedAutomationGesturePorts {
  getDocument(): ImageDocument | null;
  getBrush(): BrushSettings;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  selection: Pick<SelectionSessionController, 'begin' | 'move' | 'finish' | 'cancel'
    | 'beginPaint' | 'movePaint' | 'finishPaint' | 'cancelPaint'>;
  paint: Pick<PaintSessionController, 'begin' | 'move' | 'finish' | 'cancel'>;
}
interface Lease {
  readonly kind: LightTableGestureKind;
  readonly pointerId: number;
  readonly scope: AutomationGestureScope;
  readonly ports: MountedAutomationGesturePorts;
  readonly translation: AutomationLayerTranslationGesture | null;
}

/** One registered mount, one pointer lease. Domain controllers remain the gesture/history owners. */
export const createMountedAutomationGestureBinding = (
  session: DocumentSession | undefined,
  renderer: object | null,
  host: ScopeHost,
  getPorts: () => MountedAutomationGesturePorts
) => {
  let active: Lease | null = null;
  let retired = false;
  const capture = (): AutomationGestureScope => {
    const rendererScope = host.captureRendererScope();
    return { isCurrent: () => !retired && Boolean(session && renderer)
      && host.getCurrentSession() === session && host.getCurrentRenderer() === renderer
      && session!.getSnapshot().lifecycle === 'ready' && rendererScope.isCurrent() };
  };
  const cancel = (lease: Lease) => {
    const ports = lease.ports;
    if (lease.kind === 'selection-rectangle') return ports.selection.cancel(lease.pointerId);
    if (lease.kind === 'selection-paint') return ports.selection.cancelPaint(lease.pointerId);
    if (lease.kind === 'brush-stroke') return ports.paint.cancel(lease.pointerId);
    return lease.translation!.cancel(lease.pointerId);
  };
  const owns = (kind: LightTableGestureKind, pointerId: number) =>
    active?.kind === kind && active.pointerId === pointerId;

  return {
    beginGesture(kind: LightTableGestureKind, pointerId: number,
      parameters: Record<string, unknown>, sample: LightTableGestureSample): boolean {
      if (retired || active) return false;
      const scope = capture();
      if (!scope.isCurrent()) return false;
      const ports = getPorts();
      const translation = kind === 'layer-translate' ? new AutomationLayerTranslationGesture(ports) : null;
      let started = false;
      if (kind === 'selection-rectangle') {
        started = ports.selection.begin(pointerId, 'select-rectangle', sample,
          parameters.mode === 'add' || parameters.mode === 'subtract' || parameters.mode === 'intersect'
            ? parameters.mode : 'replace');
      } else if (kind === 'selection-paint') {
        started = ports.selection.beginPaint(pointerId, { ...sample, pressure: sample.pressure ?? 1 },
          parameters.mode === 'subtract' ? 'subtract' : 'add', {
            size: Number(parameters.size), hardness: Number(parameters.hardness),
            opacity: Number(parameters.opacity), smooth: Number(parameters.smooth)
          });
      } else {
        const document = ports.getDocument();
        const layerId = typeof parameters.layerId === 'string' ? parameters.layerId as LayerId
          : document?.activeLayerId ?? null;
        if (!document || !layerId) return false;
        if (kind === 'layer-translate') {
          started = translation!.begin(pointerId, layerId, sample, scope);
        } else {
          const layer = findRasterLayer(document, layerId);
          if (!layer) return false;
          const channel = parameters.channel === 'mask' ? 'mask' : 'pixels';
          const brush = parseAutomationBrushSettings(parameters.brush) ?? ports.getBrush();
          const operator = parameters.operator === undefined ? undefined
            : parseAutomationPaintOperator(parameters.operator) ?? undefined;
          if (parameters.operator !== undefined && !operator) return false;
          let paintOperator: PaintBrushStrokePlan | undefined;
          if (operator?.operator === 'clone' || operator?.operator === 'healing') {
            paintOperator = { ...operator, source: { ...operator.source, documentId: document.id } };
          } else if (operator?.operator === 'tone') paintOperator = operator;
          if (paintOperator && paintOperator.operator !== 'tone' && paintOperator.sampleMode !== 'all'
            && !findDocumentLayer(document, paintOperator.source.anchorLayerId)) return false;
          started = ports.paint.begin({ pointerId, layer, brush, operator: paintOperator,
            target: { layerId, channel, erase: parameters.erase === true,
              sourceToDocument: paintTargetSourceToDocument(document, layer, channel) },
            point: { ...sample, pressure: sample.pressure ?? 1 } });
        }
      }
      if (!started) return false;
      const lease = { kind, pointerId, scope, ports, translation };
      if (!scope.isCurrent()) { cancel(lease); return false; }
      active = lease;
      return true;
    },
    updateGesture(kind: LightTableGestureKind, pointerId: number, sample: LightTableGestureSample): boolean {
      if (!owns(kind, pointerId)) return false;
      const lease = active!;
      if (!lease.scope.isCurrent()) { active = null; cancel(lease); return false; }
      const ports = lease.ports;
      if (kind === 'selection-rectangle') return ports.selection.move(pointerId, sample);
      if (kind === 'selection-paint') return ports.selection.movePaint(pointerId,
        [{ ...sample, pressure: sample.pressure ?? 1 }]);
      if (kind === 'brush-stroke') return ports.paint.move(pointerId,
        { ...sample, pressure: sample.pressure ?? 1 });
      return lease.translation!.update(pointerId, sample);
    },
    finishGesture(kind: LightTableGestureKind, pointerId: number, commit: boolean): boolean {
      if (!owns(kind, pointerId)) return false;
      const lease = active!; active = null;
      if (!lease.scope.isCurrent()) { cancel(lease); return false; }
      if (!commit) return cancel(lease);
      const ports = lease.ports;
      if (kind === 'selection-rectangle') return ports.selection.finish(pointerId);
      if (kind === 'selection-paint') return ports.selection.finishPaint(pointerId);
      if (kind === 'brush-stroke') return ports.paint.finish(pointerId);
      return lease.translation!.finish(pointerId, true);
    },
    retire() {
      retired = true;
      const lease = active; active = null;
      if (lease) cancel(lease);
    }
  };
};
