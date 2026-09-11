import type { VectorLiveShape } from '@lighttable/vector-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { ShapeToolSettings, VectorEditorSelection } from '../../editor/session/editorSession';
import { vectorElementStyleSettings } from './vectorStylePresentation';

export const selectedVectorStyle = (imageDocument: ImageDocument | null, selection: VectorEditorSelection) => {
    const reference = selection.elements[0];
    if (!reference || !imageDocument) return null;
    if (reference.layerId !== imageDocument.activeLayerId) return null;
    const layer = findDocumentLayer(imageDocument, reference.layerId);
    const element = layer?.type === 'vector'
      ? layer.elements.find(({ id }) => id === reference.elementId)
      : null;
    return element ? vectorElementStyleSettings(element) : null;
};
export const selectedShapeGeometry = (imageDocument: ImageDocument | null, selection: VectorEditorSelection, defaults: ShapeToolSettings) => {
    const reference = selection.elements[0];
    if (!reference || !imageDocument) return null;
    if (reference.layerId !== imageDocument.activeLayerId) return null;
    const layer = findDocumentLayer(imageDocument, reference.layerId);
    const element = layer?.type === 'vector'
      ? layer.elements.find(({ id }) => id === reference.elementId)
      : null;
    if (element?.type !== 'live-shape'
      || (element.geometry.kind !== 'rectangle'
        && element.geometry.kind !== 'ellipse'
        && element.geometry.kind !== 'line')) return null;
    const geometry = element.geometry;
    const lineDelta = geometry.kind === 'line' ? {
      x: geometry.end.x - geometry.start.x,
      y: geometry.end.y - geometry.start.y
    } : null;
    return {
      kind: geometry.kind,
      settings: {
        ...defaults,
        width: geometry.kind === 'line' ? Math.abs(lineDelta!.x) : geometry.width,
        height: geometry.kind === 'line' ? Math.abs(lineDelta!.y) : geometry.height,
        rectangleCornerRadii: geometry.kind === 'rectangle'
          ? [...geometry.cornerRadii] as [number, number, number, number]
          : defaults.rectangleCornerRadii,
        linkedCorners: geometry.kind === 'rectangle'
          ? geometry.linkedCorners : defaults.linkedCorners,
        lineStartArrow: geometry.kind === 'line'
          ? Boolean(geometry.startArrow) : defaults.lineStartArrow,
        lineEndArrow: geometry.kind === 'line'
          ? Boolean(geometry.endArrow) : defaults.lineEndArrow,
        lineArrowWidth: geometry.kind === 'line'
          ? geometry.startArrow?.width ?? geometry.endArrow?.width ?? defaults.lineArrowWidth
          : defaults.lineArrowWidth,
        lineArrowLength: geometry.kind === 'line'
          ? geometry.startArrow?.length ?? geometry.endArrow?.length ?? defaults.lineArrowLength
          : defaults.lineArrowLength,
        lineRotationDegrees: geometry.kind === 'line'
          ? Math.atan2(lineDelta!.y, lineDelta!.x) * 180 / Math.PI
          : defaults.lineRotationDegrees
      }
    };
};

/** Applies authored shape properties only; creation preferences are handled by the intent owner. */
export const patchSelectedShape = (shape: VectorLiveShape, change: Partial<ShapeToolSettings>, defaults: ShapeToolSettings) => {
  if (shape.geometry.kind === 'rectangle') {
    shape.geometry = {
      ...shape.geometry,
      width: change.width ?? shape.geometry.width,
      height: change.height ?? shape.geometry.height,
      cornerRadii: change.rectangleCornerRadii
        ? [...change.rectangleCornerRadii] : shape.geometry.cornerRadii,
      linkedCorners: change.linkedCorners ?? shape.geometry.linkedCorners
    };
  } else if (shape.geometry.kind === 'ellipse') {
    shape.geometry = {
      ...shape.geometry,
      width: change.width ?? shape.geometry.width,
      height: change.height ?? shape.geometry.height
    };
  } else if (shape.geometry.kind === 'line') {
    const geometry = shape.geometry;
    const dx = geometry.end.x - geometry.start.x;
    const dy = geometry.end.y - geometry.start.y;
    const currentLength = Math.max(Math.hypot(dx, dy), 1e-6);
    const rotates = change.lineRotationDegrees !== undefined
      && change.lineRotationDegrees !== Math.atan2(dy, dx) * 180 / Math.PI;
    const angle = rotates
      ? change.lineRotationDegrees! * Math.PI / 180 : Math.atan2(dy, dx);
    const nextDx = rotates
      ? Math.cos(angle) * currentLength
      : change.width !== undefined ? Math.sign(dx || 1) * change.width : dx;
    const nextDy = rotates
      ? Math.sin(angle) * currentLength
      : change.height !== undefined ? Math.sign(dy || 1) * change.height : dy;
    const arrow = (current: typeof geometry.startArrow, enabled: boolean | undefined) =>
      !(enabled ?? Boolean(current)) ? null : ({
        width: change.lineArrowWidth ?? current?.width
          ?? geometry.startArrow?.width ?? geometry.endArrow?.width ?? defaults.lineArrowWidth,
        length: change.lineArrowLength ?? current?.length
          ?? geometry.startArrow?.length ?? geometry.endArrow?.length ?? defaults.lineArrowLength,
        concavity: current?.concavity ?? 0
      });
    shape.geometry = {
      ...geometry,
      end: {
        x: rotates || (change.width !== undefined && change.width !== Math.abs(dx))
          ? geometry.start.x + nextDx : geometry.end.x,
        y: rotates || (change.height !== undefined && change.height !== Math.abs(dy))
          ? geometry.start.y + nextDy : geometry.end.y
      },
      ...(geometry.startArrow || change.lineStartArrow !== undefined
        ? { startArrow: arrow(geometry.startArrow, change.lineStartArrow) } : {}),
      ...(geometry.endArrow || change.lineEndArrow !== undefined
        ? { endArrow: arrow(geometry.endArrow, change.lineEndArrow) } : {})
    };
  }
  return shape;
};
