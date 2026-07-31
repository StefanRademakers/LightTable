import { describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments } from '../../types';
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
  const port: DocumentProjectionPort = {
    getDocument: () => document,
    publishDocument: (next) => {
      if (next) document = next;
    },
    getDocumentAdjustments: () => documentAdjustments,
    publishDocumentAdjustments: (next) => {
      documentAdjustments = next;
    },
    publishEditorAdjustments: (next) => {
      editorAdjustments = next;
    },
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
    publishRendererAdjustments
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
    expect(fixture.publishRendererDocument).toHaveBeenCalledOnce();
    expect(fixture.publishRendererAdjustments).toHaveBeenCalledOnce();
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
    expect(fixture.publishRendererDocument).toHaveBeenCalledOnce();
    expect(fixture.publishRendererAdjustments).toHaveBeenCalledOnce();
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
});
