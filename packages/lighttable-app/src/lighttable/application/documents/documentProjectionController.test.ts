import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createDefaultAdjustments } from '../../types';
import {
  buildAdjustmentUniform,
  DETAIL_PAYLOAD_OFFSET
} from '../../gpu/adjustmentUniform';
import {
  createDocumentProjectionController,
  type DocumentProjectionPort
} from './documentProjectionController';

const createFixture = () => {
  let document = createImageDocument('Fixture', 16, 9, 'fixture');
  let documentAdjustments = createDefaultAdjustments();
  let editorAdjustments = documentAdjustments;
  let groupVisibility = createDefaultGroupVisibility();
  const publishRendererDocument = vi.fn();
  const publishRendererAdjustments = vi.fn();
  const publishEditorAdjustments = vi.fn((next: typeof editorAdjustments) => {
    editorAdjustments = next;
  });
  const stageEditorAdjustments = vi.fn((next: typeof editorAdjustments) => {
    editorAdjustments = next;
  });
  const port: DocumentProjectionPort = {
    getDocument: () => document,
    publishDocument: (next) => {
      if (next) document = next;
    },
    getDocumentAdjustments: () => documentAdjustments,
    publishDocumentAdjustments: (next) => {
      documentAdjustments = next;
    },
    publishEditorAdjustments,
    stageEditorAdjustments,
    getGroupVisibility: () => groupVisibility,
    publishGroupVisibility: (next) => {
      groupVisibility = next;
    },
    publishRendererDocument,
    publishRendererAdjustments
  };
  return {
    controller: createDocumentProjectionController(port),
    getDocument: () => document,
    getDocumentAdjustments: () => documentAdjustments,
    getEditorAdjustments: () => editorAdjustments,
    getGroupVisibility: () => groupVisibility,
    publishRendererDocument,
    publishRendererAdjustments,
    publishEditorAdjustments,
    stageEditorAdjustments
  };
};

describe('createDocumentProjectionController', () => {
  it('publishes canonical document and matching grade to the renderer together', () => {
    const fixture = createFixture();
    const nextDocument = {
      ...fixture.getDocument(),
      name: 'Changed'
    };

    fixture.controller.applyDocumentSnapshot(nextDocument);

    expect(fixture.getDocument()).toBe(nextDocument);
    expect(fixture.publishRendererDocument).toHaveBeenCalledWith(nextDocument);
    expect(fixture.publishRendererAdjustments).toHaveBeenCalledOnce();
  });

  it('stores a contextual grade on the active raster owner', () => {
    const fixture = createFixture();
    const nextAdjustments = {
      ...createDefaultAdjustments(),
      exposureEV: 1.25
    };
    const originalDocument = fixture.getDocument();
    const targetLayerId = originalDocument.activeLayerId!;

    fixture.controller.applyAdjustmentSnapshot(nextAdjustments, targetLayerId);

    expect(fixture.getDocument()).not.toBe(originalDocument);
    expect(fixture.getDocument().layers[0]).toMatchObject({
      type: 'raster',
      adjustmentStack: expect.objectContaining({ modules: expect.any(Array) })
    });
    expect(fixture.getDocumentAdjustments().exposureEV).toBe(0);
    expect(fixture.getEditorAdjustments()).toEqual(nextAdjustments);
    expect(fixture.publishEditorAdjustments).toHaveBeenCalledOnce();
    expect(fixture.stageEditorAdjustments).not.toHaveBeenCalled();
    expect(fixture.publishRendererDocument).toHaveBeenCalledOnce();
    expect(fixture.publishRendererAdjustments).toHaveBeenCalledOnce();
  });

  it('can commit a background Grade target without replacing Properties presentation', () => {
    const fixture = createFixture();
    const presented = fixture.getEditorAdjustments();
    const nextAdjustments = { ...createDefaultAdjustments(), contrast: 42 };

    fixture.controller.applyAdjustmentSnapshot(
      nextAdjustments,
      fixture.getDocument().activeLayerId,
      'grade',
      false
    );

    expect(fixture.getEditorAdjustments()).toBe(presented);
    expect(fixture.publishEditorAdjustments).not.toHaveBeenCalled();
    expect(fixture.publishRendererDocument).toHaveBeenCalledOnce();
    expect(fixture.getDocument().layers[0]).toMatchObject({
      adjustmentStack: expect.objectContaining({ modules: expect.any(Array) })
    });
  });

  it('previews a contextual grade without publishing the canonical document', () => {
    const fixture = createFixture();
    const originalDocument = fixture.getDocument();
    const nextAdjustments = {
      ...createDefaultAdjustments(),
      exposureEV: 0.75
    };

    fixture.controller.previewAdjustmentSnapshot(
      nextAdjustments,
      originalDocument.activeLayerId
    );

    expect(fixture.getDocument()).toBe(originalDocument);
    expect(fixture.getEditorAdjustments()).toEqual(nextAdjustments);
    expect(fixture.publishEditorAdjustments).not.toHaveBeenCalled();
    expect(fixture.stageEditorAdjustments).toHaveBeenCalledOnce();
    expect(fixture.publishRendererDocument).toHaveBeenCalledOnce();
    expect(fixture.publishRendererAdjustments).toHaveBeenCalledOnce();
  });

  it('previews and commits document-global processing without a layer owner', () => {
    const fixture = createFixture();
    const preview = {
      ...createDefaultAdjustments(),
      exposureEV: 0.75
    };

    fixture.controller.previewAdjustmentSnapshot(preview, null, 'grade');

    expect(fixture.getDocumentAdjustments().exposureEV).toBe(0);
    expect(fixture.getEditorAdjustments().exposureEV).toBe(0.75);
    expect(fixture.publishRendererAdjustments).toHaveBeenLastCalledWith(
      expect.objectContaining({ exposureEV: 0.75 })
    );

    fixture.controller.applyAdjustmentSnapshot(preview, null, 'grade');

    expect(fixture.getDocumentAdjustments().exposureEV).toBe(0.75);
    expect(fixture.publishRendererAdjustments).toHaveBeenLastCalledWith(
      expect.objectContaining({ exposureEV: 0.75 })
    );
  });

  it('advances node revisions across consecutive previews from one gesture', () => {
    const fixture = createFixture();
    const originalDocument = fixture.getDocument();
    const targetLayerId = originalDocument.activeLayerId!;

    fixture.controller.previewAdjustmentSnapshot({
      ...createDefaultAdjustments(),
      effects: {
        ...createDefaultAdjustments().effects,
        lensDistortion: {
          ...createDefaultAdjustments().effects.lensDistortion,
          enabled: true,
          amount: -40
        }
      }
    }, targetLayerId, 'lens-fx');
    fixture.controller.previewAdjustmentSnapshot({
      ...createDefaultAdjustments(),
      effects: {
        ...createDefaultAdjustments().effects,
        lensDistortion: {
          ...createDefaultAdjustments().effects.lensDistortion,
          enabled: true,
          amount: 40
        }
      }
    }, targetLayerId, 'lens-fx');

    const projectedDocuments = fixture.publishRendererDocument.mock.calls
      .map(([document]) => document);
    const revisions = projectedDocuments.map((document) => {
      const layer = findDocumentLayer(document, targetLayerId);
      if (layer?.type !== 'raster') throw new Error('Expected a raster preview owner.');
      return layer.adjustmentStack?.modules.find(({ type }) => type === 'lt.lens-distortion')?.revision;
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toEqual(expect.any(Number));
    expect(revisions[1]).toBeGreaterThan(revisions[0]!);
    expect(fixture.getDocument()).toBe(originalDocument);
  });

  it('reprojects renderer adjustments when a presentation group is bypassed', () => {
    const fixture = createFixture();
    const visibility = {
      ...fixture.getGroupVisibility(),
      color: false
    };

    fixture.controller.applyGroupVisibilitySnapshot(visibility);

    expect(fixture.getGroupVisibility()).toEqual(visibility);
    expect(fixture.publishRendererDocument).not.toHaveBeenCalled();
    expect(fixture.publishRendererAdjustments).toHaveBeenCalledOnce();
    expect(fixture.publishRendererAdjustments.mock.calls[0]?.[0]).toMatchObject({
      temperature: 0,
      tint: 0,
      vibrance: 0,
      saturation: 0
    });
  });

  it('bypasses and restores authored Detail values through the renderer payload', () => {
    const fixture = createFixture();
    const authored = createDefaultAdjustments();
    authored.detail.luminanceNoiseReduction = 100;
    fixture.controller.applyAdjustmentSnapshot(authored);
    fixture.publishRendererAdjustments.mockClear();

    fixture.controller.applyGroupVisibilitySnapshot({
      ...fixture.getGroupVisibility(),
      detail: false
    });

    const bypassed = fixture.publishRendererAdjustments.mock.calls[0]?.[0];
    expect(bypassed?.detail.luminanceNoiseReduction).toBe(0);
    expect(fixture.getDocumentAdjustments().detail.luminanceNoiseReduction).toBe(100);
    expect(buildAdjustmentUniform(bypassed!, 16, 9, false)[DETAIL_PAYLOAD_OFFSET + 4]).toBe(0);

    fixture.publishRendererAdjustments.mockClear();
    fixture.controller.applyGroupVisibilitySnapshot({
      ...fixture.getGroupVisibility(),
      detail: true
    });

    const restored = fixture.publishRendererAdjustments.mock.calls[0]?.[0];
    expect(restored?.detail.luminanceNoiseReduction).toBe(100);
    expect(buildAdjustmentUniform(restored!, 16, 9, false)[DETAIL_PAYLOAD_OFFSET + 4]).toBe(100);
  });
});
