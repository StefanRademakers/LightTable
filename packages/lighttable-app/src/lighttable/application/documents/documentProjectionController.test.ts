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

  it('keeps document grade out of the canonical layer tree', () => {
    const fixture = createFixture();
    const nextAdjustments = {
      ...createDefaultAdjustments(),
      exposure: 1.25
    };
    const originalDocument = fixture.getDocument();

    fixture.controller.applyAdjustmentSnapshot(nextAdjustments);

    expect(fixture.getDocument()).toBe(originalDocument);
    expect(fixture.getDocumentAdjustments()).toEqual(nextAdjustments);
    expect(fixture.getEditorAdjustments()).toEqual(nextAdjustments);
    expect(fixture.publishRendererDocument).not.toHaveBeenCalled();
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
