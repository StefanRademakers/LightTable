import { createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import {
  createImageDocument,
  createGroupLayer,
  createTextLayerNode,
  createVectorLayer,
  type TextLayer,
  type VectorLayer
} from './documentTypes';
import { resolvePathTextDependency } from './pathTextDependency';

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
});
