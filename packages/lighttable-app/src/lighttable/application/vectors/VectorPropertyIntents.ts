import { cloneGradientPaint } from '@lighttable/paint-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { EditorSession, ShapeToolSettings } from '../../editor/session/editorSession';
import type { VectorToolSessionController } from './VectorToolSessionController';
import { patchVectorStyle } from './vectorStylePresentation';
import { patchSelectedShape } from './vectorPropertyProjection';

export interface VectorPropertyPorts {
  getDocument(): ImageDocument | null;
  getSession(): EditorSession;
  setShapeDefaults(change: Partial<ShapeToolSettings>): void;
  setGradientDefaults(change: Partial<EditorSession['gradient']>): void;
  edits: Pick<VectorToolSessionController, 'editSelectedElementStyles' | 'editSelectedLiveShapes'>;
}

/** Property intent, not gesture/history ownership. Existing vector edits remain atomic. */
export class VectorPropertyIntents {
  constructor(private readonly getPorts: () => VectorPropertyPorts) {}
  updateStyle = (change: Partial<EditorSession['vectorStyle']>) =>
    this.getPorts().edits.editSelectedElementStyles(style => patchVectorStyle(style, change));

  updateShape = (change: Partial<ShapeToolSettings>) => {
    const p = this.getPorts();
    const { geometry, fromCenter, snapToPixels, mode, ...authored } = change;
    const defaults: Partial<ShapeToolSettings> = {};
    if (geometry !== undefined) defaults.geometry = geometry;
    if (fromCenter !== undefined) defaults.fromCenter = fromCenter;
    if (snapToPixels !== undefined) defaults.snapToPixels = snapToPixels;
    if (mode !== undefined) defaults.mode = mode;
    if (Object.keys(defaults).length) p.setShapeDefaults(defaults);
    if (!Object.keys(authored).length) return false;
    const shapeDefaults = p.getSession().shape;
    return p.edits.editSelectedLiveShapes(shape => patchSelectedShape(shape, authored, shapeDefaults));
  };

  updateGradient = (change: Partial<EditorSession['gradient']>) => {
    const p = this.getPorts();
    const session = p.getSession();
    const document = p.getDocument();
    p.setGradientDefaults(change);
    if (!change.paint || session.activeTool !== 'gradient'
      || session.gradient.application !== 'fill-layer') return false;
    const reference = session.vectorSelection.elements[0];
    const layer = reference && document?.activeLayerId === reference.layerId
      ? findDocumentLayer(document, reference.layerId) : null;
    if (layer?.type !== 'vector' || layer.role !== 'gradient-fill') return false;
    const paint = change.paint;
    return p.edits.editSelectedElementStyles(style => {
      const fill = style.fill;
      if (!fill || !('kind' in fill)) return style;
      return { ...style, fill: { ...cloneGradientPaint(paint),
        coordinateSpace: fill.coordinateSpace, transform: { ...fill.transform } } };
    });
  };
}
