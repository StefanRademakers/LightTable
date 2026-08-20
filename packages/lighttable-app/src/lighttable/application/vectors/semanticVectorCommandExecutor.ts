import { cloneVectorElement, cloneVectorStyle, createVectorLiveShape, createVectorPath,
  parseVectorElement, translationMatrix, type VectorElement, type VectorStyle } from '@lighttable/vector-core';
import { appendVectorElement, createVectorLayer, deleteVectorElements,
  replaceVectorElement } from '../../editor/document/documentCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { canonicalSubpathsFromSemantic, type SemanticVectorCommand,
  type SemanticVectorPrimitive, type SemanticVectorStylePatch } from '../commands/semanticVectorCommandContract';

export interface SemanticVectorCommandDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  recordHistory(before: ImageDocument, after: ImageDocument): void;
}

const nextId = (kind: string) => `${kind}-${crypto.randomUUID()}`;
const applyStyle = (base: VectorStyle, patch: SemanticVectorStylePatch | undefined): VectorStyle => ({
  fill: patch && Object.hasOwn(patch, 'fill') ? structuredClone(patch.fill ?? null) : structuredClone(base.fill),
  stroke: patch && Object.hasOwn(patch, 'stroke') ? structuredClone(patch.stroke ?? null) : structuredClone(base.stroke),
  opacity: patch?.opacity ?? base.opacity
});

const primitiveElement = (primitive: SemanticVectorPrimitive, name: string): VectorElement => {
  let geometry; let transform;
  if (primitive.kind === 'rectangle') {
    geometry = { kind: 'rectangle' as const, width: primitive.width, height: primitive.height,
      cornerRadii: [...(primitive.cornerRadii ?? [0, 0, 0, 0])] as [number, number, number, number],
      linkedCorners: primitive.linkedCorners ?? true };
    transform = translationMatrix(primitive.x, primitive.y);
  } else if (primitive.kind === 'ellipse') {
    geometry = { kind: 'ellipse' as const, width: primitive.width, height: primitive.height };
    transform = translationMatrix(primitive.x, primitive.y);
  } else if (primitive.kind === 'triangle') {
    geometry = { kind: 'triangle' as const, width: primitive.width, height: primitive.height,
      cornerRadius: primitive.cornerRadius ?? 0 };
    transform = translationMatrix(primitive.x, primitive.y);
  } else if (primitive.kind === 'star') {
    geometry = { kind: 'star' as const, points: primitive.points, outerRadius: primitive.outerRadius,
      innerRadius: primitive.innerRadius, rotationRadians: primitive.rotationRadians ?? -Math.PI / 2,
      cornerRadius: primitive.cornerRadius ?? 0 };
    transform = translationMatrix(primitive.cx, primitive.cy);
  } else {
    geometry = { kind: 'line' as const, start: { x: 0, y: 0 },
      end: { x: primitive.x2 - primitive.x1, y: primitive.y2 - primitive.y1 },
      startArrow: structuredClone(primitive.startArrow ?? null),
      endArrow: structuredClone(primitive.endArrow ?? null) };
    transform = translationMatrix(primitive.x1, primitive.y1);
  }
  const element = createVectorLiveShape(nextId('shape'), geometry, name);
  element.transform = transform;
  if (primitive.kind === 'line') {
    element.style.fill = null;
    element.style.stroke = { paint: { type: 'solid', color: [0, 0, 0, 1] }, width: 1,
      alignment: 'center', cap: 'butt', join: 'miter', miterLimit: 4, dash: [], dashOffset: 0 };
  }
  return element;
};

const createElement = (command: Extract<SemanticVectorCommand, { kind: 'create' }>) => {
  const name = command.name ?? (command.primitive
    ? `${command.primitive.kind[0].toUpperCase()}${command.primitive.kind.slice(1)}` : 'Path');
  const element = command.primitive ? primitiveElement(command.primitive, name)
    : createVectorPath(nextId('path'), name,
      canonicalSubpathsFromSemantic(command.subpaths!, nextId));
  if (element.type === 'path') element.fillRule = command.fillRule ?? 'nonzero';
  if (command.transform) element.transform = { ...command.transform };
  element.style = applyStyle(element.style, command.style);
  return parseVectorElement(element, 'semantic vector creation');
};

const updateElement = (
  element: VectorElement, command: Extract<SemanticVectorCommand, { kind: 'update' }>
): VectorElement => {
  const next = cloneVectorElement(element);
  if (command.name) next.name = command.name;
  if (command.transform) {
    next.transform = { ...command.transform };
    next.transformRevision += 1;
  }
  if (command.style) {
    next.style = applyStyle(cloneVectorStyle(next.style), command.style);
    next.styleRevision += 1;
  }
  if (command.geometry !== undefined) {
    if (next.type !== 'live-shape') throw new Error('Only live shapes accept geometry updates.');
    next.geometry = structuredClone(command.geometry);
    next.geometryRevision += 1;
  }
  if (command.subpaths !== undefined) {
    if (next.type !== 'path') throw new Error('Only path elements accept subpath updates.');
    next.subpaths = canonicalSubpathsFromSemantic(command.subpaths, nextId);
    next.geometryRevision += 1;
  }
  if (command.fillRule !== undefined) {
    if (next.type !== 'path') throw new Error('Only path elements have a fill rule.');
    next.fillRule = command.fillRule;
    next.geometryRevision += 1;
  }
  return parseVectorElement(next, 'semantic vector update');
};

export const executeSemanticVectorCommand = (
  command: SemanticVectorCommand, dependencies: SemanticVectorCommandDependencies
): { readonly layerId: LayerId; readonly elementId: string } | null => {
  const before = dependencies.getDocument();
  if (!before) return null;
  let after = before; let layerId = 'layerId' in command ? command.layerId as LayerId : null;
  let elementId = 'elementId' in command ? command.elementId : '';
  if (command.kind === 'create') {
    const element = createElement(command); elementId = element.id;
    const target = command.layerId ? findDocumentLayer(before, command.layerId as LayerId) : null;
    if (command.layerId && (target?.type !== 'vector' || layerIsLocked(target, 'pixels'))) {
      throw new Error('The requested vector target is unavailable or locked.');
    }
    after = target?.type === 'vector' ? appendVectorElement(before, target.id, element)
      : createVectorLayer(before, [element], command.layerName ?? command.name ?? 'Shape');
    layerId = target?.type === 'vector' ? target.id : after.activeLayerId;
  } else {
    const layer = findDocumentLayer(before, command.layerId as LayerId);
    if (layer?.type !== 'vector' || layerIsLocked(layer, 'pixels')) throw new Error('The vector layer is unavailable or locked.');
    const element = layer.elements.find(({ id }) => id === command.elementId);
    if (!element) throw new Error('The vector element no longer exists.');
    after = command.kind === 'remove' ? deleteVectorElements(before, layer.id, [element.id])
      : replaceVectorElement(before, layer.id, updateElement(element, command));
  }
  if (after === before || !layerId) return null;
  dependencies.applyDocument(after);
  dependencies.recordHistory(before, after);
  return { layerId, elementId };
};
