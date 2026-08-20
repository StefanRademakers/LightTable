import {
  createDefaultFlowTextSource,
  createDefaultTextLayerData,
  type FlowTextLayout,
  type RgbaColor
} from '@lighttable/text-core';
import { createTextLayer, setLayerTransform } from '../../editor/document/documentCommands';
import type {
  DocumentFontAsset,
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import type { TextToolSettings } from '../../editor/session/editorSession';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import { findLayerNode } from '../../editor/document/layerTree';
import {
  buildSceneTransformIndex,
  documentPointToLocal
} from '../../editor/document/sceneTransformGraph';
import { translationMatrix } from '../../editor/geometry/affine';

export interface PointTextCreationRequest {
  readonly documentId: ImageDocument['id'];
  readonly origin: { readonly x: number; readonly y: number };
  readonly text: string;
}

export interface PointTextCreationSnapshot {
  readonly status: 'idle' | 'editing';
  readonly request: PointTextCreationRequest | null;
}

export interface PathTextCreationTarget {
  readonly pathLayerId: LayerId;
  readonly pathElementId: string;
  readonly pathSubpathId: string;
}

export interface PathTextLayoutOptions {
  readonly startOffset: number;
  readonly side: 'left' | 'right';
  readonly upright: boolean;
  readonly direction: 'forward' | 'reverse';
}

export type PathTextCreationTargetResolution =
  | { readonly kind: 'resolved'; readonly target: PathTextCreationTarget }
  | { readonly kind: 'none' | 'ambiguous' | 'live-shape' | 'ambiguous-subpath' };

/** Resolves only explicit native path selection; it never guesses among siblings. */
export const resolvePathTextCreationTarget = (
  document: ImageDocument,
  selection: VectorEditorSelection
): PathTextCreationTargetResolution => {
  const references = new Map<string, { layerId: LayerId; elementId: string }>();
  selection.elements.forEach(({ layerId, elementId }) => {
    references.set(`${layerId}\0${elementId}`, { layerId, elementId });
  });
  selection.paths.forEach(({ layerId, pathId }) => {
    references.set(`${layerId}\0${pathId}`, { layerId, elementId: pathId });
  });
  if (selection.active) {
    references.set(`${selection.active.layerId}\0${selection.active.pathId}`, {
      layerId: selection.active.layerId,
      elementId: selection.active.pathId
    });
  }
  if (references.size === 0) return { kind: 'none' };
  if (references.size !== 1) return { kind: 'ambiguous' };
  const reference = [...references.values()][0]!;
  const layer = findLayerNode(document.layers, reference.layerId)?.node;
  if (!layer || layer.type !== 'vector') return { kind: 'none' };
  const element = layer.elements.find(({ id }) => id === reference.elementId);
  if (!element) return { kind: 'none' };
  if (element.type !== 'path') return { kind: 'live-shape' };
  const selectedSubpaths = new Set<string>();
  selection.anchors
    .filter(({ layerId, pathId }) => layerId === layer.id && pathId === element.id)
    .forEach(({ subpathId }) => selectedSubpaths.add(subpathId));
  const activeTarget = selection.active?.layerId === layer.id
    && selection.active.pathId === element.id ? selection.active.target : null;
  if (activeTarget && activeTarget.kind !== 'fill') {
    selectedSubpaths.add(activeTarget.subpathId);
  }
  let subpathId: string | null = null;
  if (selectedSubpaths.size === 1) subpathId = [...selectedSubpaths][0]!;
  else if (selectedSubpaths.size > 1) return { kind: 'ambiguous-subpath' };
  else if (element.subpaths.length === 1) subpathId = element.subpaths[0]!.id;
  else return { kind: 'ambiguous-subpath' };
  if (!element.subpaths.some(({ id }) => id === subpathId)) return { kind: 'none' };
  return {
    kind: 'resolved',
    target: {
      pathLayerId: layer.id,
      pathElementId: element.id,
      pathSubpathId: subpathId
    }
  };
};

export interface ParagraphTextCreationRequest {
  readonly documentId: ImageDocument['id'];
  readonly pointerId: number | null;
  readonly aboveLayerId: ImageDocument['activeLayerId'];
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly text: string;
}

export interface ParagraphTextCreationSnapshot {
  readonly status: 'idle' | 'dragging' | 'editing';
  readonly request: ParagraphTextCreationRequest | null;
}

export const resolveTextToolFont = (
  fonts: readonly DocumentFontAsset[],
  settings: Pick<TextToolSettings, 'family' | 'style'>
) => [...fonts]
  .sort((left, right) =>
    left.styleName.localeCompare(right.styleName)
    || left.fingerprintSha256.localeCompare(right.fingerprintSha256)
    || left.faceIndex - right.faceIndex
    || left.assetId.localeCompare(right.assetId)
  )
  .find((font) =>
    font.familyNames.includes(settings.family)
    && font.styleName === settings.style
  ) ?? null;

export const defaultTextStyleForFamily = (
  fonts: readonly DocumentFontAsset[],
  family: string
) => resolveTextToolFont(
  fonts.filter((font) => font.familyNames.includes(family)),
  { family, style: 'Regular' }
)?.styleName ?? [...fonts]
  .filter((font) => font.familyNames.includes(family))
  .sort((left, right) =>
    left.styleName.localeCompare(right.styleName)
    || left.fingerprintSha256.localeCompare(right.fingerprintSha256)
    || left.assetId.localeCompare(right.assetId)
  )[0]?.styleName ?? null;

/** Resolve one Type Tool pointer gesture in screen-space, independent of zoom. */
export const textCreationKind = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  documentScale: number,
  dragThresholdPx = 4
): 'point' | 'paragraph' => Math.hypot(end.x - start.x, end.y - start.y)
  * Math.max(documentScale, 1e-6) < dragThresholdPx
  ? 'point'
  : 'paragraph';

export class PointTextCreationController {
  private snapshot: PointTextCreationSnapshot = { status: 'idle', request: null };
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(documentId: ImageDocument['id'], origin: PointTextCreationRequest['origin']) {
    this.snapshot = {
      status: 'editing',
      request: { documentId, origin: { ...origin }, text: 'Text' }
    };
    this.emit();
  }

  update(text: string) {
    if (!this.snapshot.request) return false;
    this.snapshot = {
      status: 'editing',
      request: { ...this.snapshot.request, text }
    };
    this.emit();
    return true;
  }

  commit(): PointTextCreationRequest | null {
    const request = this.snapshot.request;
    this.cancel();
    return request?.text.length ? request : null;
  }

  cancel() {
    if (!this.snapshot.request) return false;
    this.snapshot = { status: 'idle', request: null };
    this.emit();
    return true;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

export class ParagraphTextCreationController {
  private snapshot: ParagraphTextCreationSnapshot = { status: 'idle', request: null };
  private readonly listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(
    documentId: ImageDocument['id'],
    aboveLayerId: ImageDocument['activeLayerId'],
    pointerId: number,
    start: ParagraphTextCreationRequest['start']
  ) {
    if (this.snapshot.status !== 'idle') return false;
    this.snapshot = {
      status: 'dragging',
      request: {
        documentId,
        aboveLayerId,
        pointerId,
        start: { ...start },
        end: { ...start },
        text: 'Text'
      }
    };
    this.emit();
    return true;
  }

  owns(pointerId: number) {
    return this.snapshot.status === 'dragging'
      && this.snapshot.request?.pointerId === pointerId;
  }

  move(pointerId: number, end: ParagraphTextCreationRequest['end']) {
    if (!this.owns(pointerId) || !this.snapshot.request) return false;
    this.snapshot = {
      status: 'dragging',
      request: { ...this.snapshot.request, end: { ...end } }
    };
    this.emit();
    return true;
  }

  finish(pointerId: number) {
    if (!this.owns(pointerId) || !this.snapshot.request) return false;
    const request = this.snapshot.request;
    const width = Math.abs(request.end.x - request.start.x);
    const height = Math.abs(request.end.y - request.start.y);
    this.snapshot = {
      status: 'editing',
      request: {
        ...request,
        pointerId: null,
        end: {
          x: width >= 1 ? request.end.x : request.start.x + 240,
          y: height >= 1 ? request.end.y : request.start.y + 120
        }
      }
    };
    this.emit();
    return true;
  }

  update(text: string) {
    if (this.snapshot.status !== 'editing' || !this.snapshot.request) return false;
    this.snapshot = {
      status: 'editing',
      request: { ...this.snapshot.request, text }
    };
    this.emit();
    return true;
  }

  commit(): ParagraphTextCreationRequest | null {
    if (this.snapshot.status !== 'editing') return null;
    const request = this.snapshot.request;
    this.cancel();
    return request?.text.length ? request : null;
  }

  cancel() {
    if (!this.snapshot.request) return false;
    this.snapshot = { status: 'idle', request: null };
    this.emit();
    return true;
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

const colorFromHex = (hex: string): RgbaColor => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 };
  return {
    colorSpace: 'srgb',
    r: Number.parseInt(match[1]!, 16) / 255,
    g: Number.parseInt(match[2]!, 16) / 255,
    b: Number.parseInt(match[3]!, 16) / 255,
    a: 1
  };
};

const createAuthoredFlowTextData = (
  value: string,
  layout: FlowTextLayout,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string
) => {
  const source = createDefaultFlowTextSource(value);
  const preferredAsset = {
    assetId: font.assetId,
    faceIndex: font.faceIndex,
    fingerprintSha256: font.fingerprintSha256,
    source: font.source,
    container: font.container,
    outline: font.outline,
    postScriptName: font.postScriptName,
    embedding: { ...font.embedding }
  };
  return {
    ...createDefaultTextLayerData(),
    source: {
      ...source,
      layout,
      styleRuns: source.styleRuns.map((run) => ({
        ...run,
        requestedFont: {
          families: [font.familyNames[0] ?? settings.family],
          postScriptName: font.postScriptName,
          preferredAsset
        },
        fontSize: settings.size,
        fontWeight: font.weight,
        fontStyle: font.italic ? 'italic' as const : 'normal' as const,
        fontStretch: font.stretch,
        ...(settings.fillEnabled !== false
          ? { fill: { kind: 'solid' as const, color: colorFromHex(foregroundColor) } }
          : {})
      })),
      paragraphRuns: source.paragraphRuns.map((run) => ({
        ...run,
        alignment: settings.alignment
      }))
    }
  };
};

const attachFontAsset = (
  document: ImageDocument,
  font: DocumentFontAsset
): ImageDocument => document.assets.fonts.some(({ assetId }) => assetId === font.assetId)
  ? document
  : {
      ...document,
      assets: {
        ...document.assets,
        fonts: [...document.assets.fonts, structuredClone(font)]
      }
    };

export const createPointTextDocument = (
  document: ImageDocument,
  request: PointTextCreationRequest,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string,
  writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' = 'horizontal-tb'
): ImageDocument => {
  if (request.documentId !== document.id) return document;
  const anchor = document.activeLayerId
    ? findLayerNode(document.layers, document.activeLayerId)
    : null;
  const parentPoint = anchor?.parentId
    ? documentPointToLocal(
        buildSceneTransformIndex(document).get(anchor.parentId)!,
        request.origin
      )
    : request.origin;
  if (!parentPoint) return document;
  const text = createAuthoredFlowTextData(
    request.text,
    {
        mode: 'point' as const,
        origin: { x: 0, y: 0 },
        writingMode
    },
    settings,
    font,
    foregroundColor
  );
  const inserted = createTextLayer(document, text, request.text.slice(0, 40) || 'Text');
  const withLayer = inserted.activeLayerId
    ? setLayerTransform(
        inserted,
        inserted.activeLayerId,
        translationMatrix(parentPoint.x, parentPoint.y)
      )
    : inserted;
  return attachFontAsset(withLayer, font);
};

export const createParagraphTextDocument = (
  document: ImageDocument,
  request: ParagraphTextCreationRequest,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string,
  writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' = 'horizontal-tb'
): ImageDocument => {
  if (request.documentId !== document.id) return document;
  const anchor = request.aboveLayerId
    ? findLayerNode(document.layers, request.aboveLayerId)
    : null;
  const parentTransform = anchor?.parentId
    ? buildSceneTransformIndex(document).get(anchor.parentId)
    : null;
  const start = parentTransform
    ? documentPointToLocal(parentTransform, request.start)
    : request.start;
  const end = parentTransform
    ? documentPointToLocal(parentTransform, request.end)
    : request.end;
  if (!start || !end) return document;
  const origin = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 1 || height < 1) return document;
  const text = createAuthoredFlowTextData(
    request.text,
    {
      mode: 'paragraph',
      frame: { x: 0, y: 0, width, height },
      overflow: 'indicator',
      writingMode
    },
    settings,
    font,
    foregroundColor
  );
  const inserted = createTextLayer(
    document,
    text,
    request.text.slice(0, 40) || 'Text',
    request.aboveLayerId
  );
  const positioned = inserted.activeLayerId
    ? setLayerTransform(
        inserted,
        inserted.activeLayerId,
        translationMatrix(origin.x, origin.y)
      )
    : inserted;
  return attachFontAsset(positioned, font);
};

export const createPathTextDocument = (
  document: ImageDocument,
  request: PointTextCreationRequest,
  target: PathTextCreationTarget,
  settings: TextToolSettings,
  font: DocumentFontAsset,
  foregroundColor: string,
  layout: PathTextLayoutOptions = {
    startOffset: 0,
    side: 'left',
    upright: true,
    direction: 'forward'
  }
): ImageDocument => {
  if (request.documentId !== document.id) return document;
  const layer = findLayerNode(document.layers, target.pathLayerId)?.node;
  if (!layer || layer.type !== 'vector') return document;
  const path = layer.elements.find(({ id }) => id === target.pathElementId);
  if (path?.type !== 'path'
    || !path.subpaths.some(({ id }) => id === target.pathSubpathId)) return document;
  const text = createAuthoredFlowTextData(
    request.text,
    {
      mode: 'path',
      pathLayerId: target.pathLayerId,
      pathElementId: target.pathElementId,
      pathSubpathId: target.pathSubpathId,
      startOffset: layout.startOffset,
      side: layout.side,
      upright: layout.upright,
      direction: layout.direction
    },
    settings,
    font,
    foregroundColor
  );
  return attachFontAsset(createTextLayer(
    document,
    text,
    request.text.slice(0, 40) || 'Path Text',
    target.pathLayerId
  ), font);
};
