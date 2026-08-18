import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { identityAffineMatrix } from '../../editor/geometry/affine';
import { createDocumentGeometryPlan, projectDocumentGeometry, projectSelectionGeometry } from './documentGeometryModel';

describe('document geometry model', () => {
  it.each([
    [0, 0, 0, 0], [0.5, 0.5, 50, 25], [1, 1, 100, 50]
  ] as const)('anchors canvas expansion at %s/%s', (anchorX, anchorY, tx, ty) => {
    const plan = createDocumentGeometryPlan({ width: 100, height: 50 }, {
      operation: 'canvas-size', width: 200, height: 100, anchorX, anchorY
    });
    expect(plan.oldDocumentToNewDocument).toMatchObject({ tx, ty });
    expect(plan.expansionRegions.reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBe(15_000);
  });

  it('creates exact orthogonal matrices and swaps dimensions', () => {
    expect(createDocumentGeometryPlan({ width: 511, height: 257 }, {
      operation: 'rotate', rotation: 'clockwise-90'
    })).toMatchObject({
      targetWidth: 257, targetHeight: 511, sampling: 'exact-orthogonal',
      oldDocumentToNewDocument: { a: 0, b: 1, c: -1, d: 0, tx: 257, ty: 0 }
    });
    expect(createDocumentGeometryPlan({ width: 511, height: 257 }, {
      operation: 'flip', axis: 'horizontal'
    }).oldDocumentToNewDocument).toEqual({ a: -1, b: 0, c: 0, d: 1, tx: 511, ty: 0 });
  });

  it('rounds arbitrary rotation bounds deterministically', () => {
    const plan = createDocumentGeometryPlan({ width: 100, height: 50 }, {
      operation: 'rotate', rotation: { degrees: 45 }
    });
    expect(plan.targetWidth).toBe(107);
    expect(plan.targetHeight).toBe(107);
    expect(plan.sampling).toBe('filtered-affine');
  });

  it('drops guides when arbitrary rotation cannot represent them exactly', () => {
    const document = createImageDocument('Geometry', 100, 50, 'source');
    document.guides = [{ id: 'h', orientation: 'horizontal', position: 10 }];
    const plan = createDocumentGeometryPlan(document, {
      operation: 'rotate', rotation: { degrees: 12 }
    });

    expect(projectDocumentGeometry(document, plan).guides).toEqual([]);
  });

  it('projects root transforms, masks and guides while preserving nested local geometry', () => {
    const document = createImageDocument('Geometry', 100, 50, 'source');
    const root = document.layers[0]!;
    root.mask = { id: 'mask', enabled: true, linked: false, transform: identityAffineMatrix(), density: 1, feather: 0, revision: 0, pixelRevision: 0, dirtyBounds: null };
    document.guides = [
      { id: 'h', orientation: 'horizontal', position: 10 },
      { id: 'v', orientation: 'vertical', position: 20 }
    ];
    const plan = createDocumentGeometryPlan(document, { operation: 'rotate', rotation: 'clockwise-90' });
    const next = projectDocumentGeometry(document, plan);
    expect(next).toMatchObject({ width: 50, height: 100 });
    expect(next.layers[0]!.transform).toEqual(plan.oldDocumentToNewDocument);
    expect(next.layers[0]!.mask?.transform).toEqual(identityAffineMatrix());
    expect(next.guides).toEqual([
      { id: 'h', orientation: 'vertical', position: 40 },
      { id: 'v', orientation: 'horizontal', position: 20 }
    ]);
  });

  it('uses crop bounds as a reversible document-space translation', () => {
    const plan = createDocumentGeometryPlan({ width: 100, height: 80 }, {
      operation: 'crop', bounds: { x: 10, y: 15, width: 40, height: 30 }
    });
    expect(plan).toMatchObject({ targetWidth: 40, targetHeight: 30, oldDocumentToNewDocument: { tx: -10, ty: -15 } });
  });

  it('projects selection replay through the identical document mapping', () => {
    const plan = createDocumentGeometryPlan({ width: 100, height: 80 }, {
      operation: 'canvas-size', width: 120, height: 100, anchorX: 0.5, anchorY: 0.5
    });
    const [selection] = projectSelectionGeometry([{
      mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 2, y: 3 }, { x: 8, y: 9 }] }
    }], plan);
    expect(selection?.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 10 });
  });
});
