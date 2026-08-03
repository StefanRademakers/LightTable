import { createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import {
  buildLayeredDocumentFile,
  parseLayeredDocumentFile
} from '../persistence/layeredDocumentFormat';
import {
  createImageDocument,
  createGroupLayer,
  createTextLayerNode,
  createVectorLayer,
  type TextLayer,
  type VectorLayer
} from './documentTypes';
import { resolvePathTextDependency } from './pathTextDependency';
import { findDocumentLayer } from './layerTree';
import {
  createGroupLayer as createGroupLayerCommand,
  deleteLayer,
  duplicateLayer,
  moveLayerIntoGroup
} from './documentCommands';

const fixture = (pathElementId?: string, pathSubpathId?: string) => {
  const path = createVectorPath('path-a', 'Curve', [createSubpath('curve-a')]);
  const vector = createVectorLayer([path], 'Paths');
  const data = createDefaultTextLayerData();
  if (data.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
  const text = createTextLayerNode({
    ...data,
    source: {
      ...data.source,
      layout: {
        mode: 'path', pathLayerId: vector.id,
        ...(pathElementId ? { pathElementId } : {}),
        ...(pathSubpathId ? { pathSubpathId } : {}),
        startOffset: 0, side: 'left', upright: true
      }
    }
  }, 'Path text');
  const document = createImageDocument('Path text', 100, 100, 'source');
  document.layers = [vector, text];
  return { document, vector, text };
};

describe('path text dependency', () => {
  it('resolves an exact vector element and changes revision with path geometry or transforms', () => {
    const { document, vector, text } = fixture('path-a', 'curve-a');
    const opening = resolvePathTextDependency(document, text);
    expect(opening).toMatchObject({
      kind: 'resolved', path: { id: 'path-a' }, subpath: { id: 'curve-a' },
      layerToDocument: { a: 1, d: 1, tx: 0, ty: 0 }
    });

    const changedPath = {
      ...vector.elements[0]!, geometryRevision: 1,
      transform: { ...vector.elements[0]!.transform, tx: 4 }, transformRevision: 1
    };
    const changedLayer: VectorLayer = {
      ...vector,
      transform: { ...vector.transform, ty: 8 },
      elements: [changedPath]
    };
    document.layers = [changedLayer, text];
    const changed = resolvePathTextDependency(document, text);
    expect(changed).toMatchObject({ kind: 'resolved' });
    expect(changed.revision).not.toBe(opening.revision);
  });

  it('resolves ancestor transforms and invalidates when a containing group moves', () => {
    const { document, vector, text } = fixture('path-a', 'curve-a');
    vector.transform = { ...vector.transform, tx: 3, ty: 5 };
    const group = createGroupLayer('Nested paths');
    group.transform = { ...group.transform, a: 2, d: 3, tx: 7, ty: 11 };
    group.children = [vector];
    document.layers = [group, text];
    const opening = resolvePathTextDependency(document, text);
    expect(opening).toMatchObject({
      kind: 'resolved',
      layerToDocument: { a: 2, d: 3, tx: 13, ty: 26 }
    });
    group.transform = { ...group.transform, tx: 9 };
    const changed = resolvePathTextDependency(document, text);
    expect(changed).toMatchObject({
      kind: 'resolved',
      layerToDocument: { a: 2, d: 3, tx: 15, ty: 26 }
    });
    expect(changed.revision).not.toBe(opening.revision);
  });

  it('accepts a legacy layer-only reference only when exactly one path exists', () => {
    const { document, vector, text } = fixture();
    expect(resolvePathTextDependency(document, text).kind).toBe('resolved');
    vector.elements.push(createVectorPath('path-b', 'Second', [createSubpath('curve-b')]));
    expect(resolvePathTextDependency(document, text)).toMatchObject({
      kind: 'ambiguous-legacy-reference', layerId: vector.id
    });
  });

  it('reports missing layers and elements without selecting a fallback sibling', () => {
    const { document, vector, text } = fixture('missing');
    expect(resolvePathTextDependency(document, text)).toMatchObject({
      kind: 'missing-element', layerId: vector.id, elementId: 'missing'
    });
    if (text.text.source.kind !== 'flow' || text.text.source.layout.mode !== 'path') {
      throw new Error('Expected path text fixture.');
    }
    const missingLayer: TextLayer = {
      ...text,
      text: {
        ...text.text,
        source: {
          ...text.text.source,
          layout: { ...text.text.source.layout, pathLayerId: 'deleted-layer' }
        }
      }
    };
    expect(resolvePathTextDependency(document, missingLayer)).toMatchObject({
      kind: 'missing-layer', layerId: 'deleted-layer'
    });
  });

  it('requires an exact subpath when one vector element contains multiple contours', () => {
    const { document, vector, text } = fixture('path-a');
    const path = vector.elements[0];
    if (path?.type !== 'path') throw new Error('Expected vector path fixture.');
    path.subpaths.push(createSubpath('curve-b'));
    expect(resolvePathTextDependency(document, text)).toMatchObject({
      kind: 'ambiguous-legacy-subpath', layerId: vector.id, elementId: path.id
    });

    const exact = fixture('path-a', 'missing-curve');
    expect(resolvePathTextDependency(exact.document, exact.text)).toMatchObject({
      kind: 'missing-subpath', subpathId: 'missing-curve'
    });
  });

  it('keeps text duplication bound to the exact original path', () => {
    const { document, vector, text } = fixture('path-a', 'curve-a');
    const duplicated = duplicateLayer(document, text.id);
    const clone = findDocumentLayer(duplicated, duplicated.activeLayerId);
    expect(clone?.type).toBe('text');
    if (clone?.type !== 'text') throw new Error('Expected duplicated text.');
    expect(resolvePathTextDependency(duplicated, clone)).toMatchObject({
      kind: 'resolved', layer: { id: vector.id }, path: { id: 'path-a' },
      subpath: { id: 'curve-a' }
    });
  });

  it('duplicates vector identity without stealing existing path-text references', () => {
    const { document, vector, text } = fixture('path-a', 'curve-a');
    const duplicated = duplicateLayer(document, vector.id);
    const clone = findDocumentLayer(duplicated, duplicated.activeLayerId);
    expect(clone?.type).toBe('vector');
    if (clone?.type !== 'vector') throw new Error('Expected duplicated vector.');
    expect(clone.id).not.toBe(vector.id);
    expect(clone.elements[0]?.id).not.toBe('path-a');
    expect(clone.elements[0]?.type === 'path' ? clone.elements[0].subpaths[0]?.id : null)
      .not.toBe('curve-a');
    expect(resolvePathTextDependency(duplicated, text)).toMatchObject({
      kind: 'resolved', layer: { id: vector.id }, path: { id: 'path-a' }
    });
  });

  it('preserves stable references while grouping and reports deletion explicitly', () => {
    const { document, vector, text } = fixture('path-a', 'curve-a');
    const withGroup = createGroupLayerCommand(document, 'Paths');
    const groupId = withGroup.activeLayerId!;
    const grouped = moveLayerIntoGroup(withGroup, vector.id, groupId);
    expect(resolvePathTextDependency(grouped, text)).toMatchObject({
      kind: 'resolved', layer: { id: vector.id }, path: { id: 'path-a' }
    });
    const deleted = deleteLayer(grouped, groupId);
    expect(resolvePathTextDependency(deleted, text)).toEqual({
      kind: 'missing-layer', revision: 0, layerId: vector.id
    });
  });

  it('round-trips exact path references through the native layered format', async () => {
    const { document, text } = fixture('path-a', 'curve-a');
    const file = buildLayeredDocumentFile(
      new Blob([new Uint8Array([0])], { type: 'image/png' }),
      document,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      [],
      'path-text.png'
    );
    const parsed = await parseLayeredDocumentFile(file);
    expect(parsed).not.toBeNull();
    const reopened = parsed && findDocumentLayer(parsed.document, text.id);
    expect(reopened?.type).toBe('text');
    if (reopened?.type !== 'text' || !parsed) throw new Error('Expected reopened path text.');
    expect(resolvePathTextDependency(parsed.document, reopened)).toMatchObject({
      kind: 'resolved', path: { id: 'path-a' }, subpath: { id: 'curve-a' }
    });
  });
});
