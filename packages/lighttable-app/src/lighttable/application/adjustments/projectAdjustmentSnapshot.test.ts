import { describe, expect, it } from 'vitest';
import {
  createDefaultAdjustments
} from '../../types';
import {
  createImageDocument,
  createLayerId
} from '../../editor/document/documentTypes';
import {
  createAdjustmentLayer
} from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import { projectAdjustmentSnapshot } from './projectAdjustmentSnapshot';

describe('adjustment snapshot projection', () => {
  it('replaces the document output grade when no layer target is selected', () => {
    const document = createImageDocument('Image', 64, 48, 'image');
    const snapshot = {
      ...createDefaultAdjustments(),
      exposureEV: 1.5
    };
    const result = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: null,
      document,
      documentAdjustments: createDefaultAdjustments()
    });
    expect(result.scope).toBe('document');
    expect(result.document).toBe(document);
    expect(result.documentAdjustments.exposureEV).toBe(1.5);
  });

  it('updates one Adjustment Layer while retaining document Lens Fx', () => {
    const base = createImageDocument('Image', 64, 48, 'image');
    const document = createAdjustmentLayer(
      base,
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'Grade'
    );
    const adjustmentId = document.activeLayerId;
    if (!adjustmentId) throw new Error('Expected an active Adjustment Layer.');
    const documentAdjustments = createDefaultAdjustments();
    documentAdjustments.effects.grain.enabled = true;
    documentAdjustments.effects.grain.amount = 1.55;
    const snapshot = {
      ...structuredClone(documentAdjustments),
      contrast: 35
    };
    const result = projectAdjustmentSnapshot({
      snapshot,
      targetLayerId: adjustmentId,
      document,
      documentAdjustments
    });
    expect(result.scope).toBe('adjustment-layer');
    expect(result.documentAdjustments.effects.grain.enabled).toBe(true);
    expect(result.documentAdjustments.effects.grain.amount).toBe(1.55);
    expect(result.documentAdjustments.contrast).toBe(0);
    if (!result.document) throw new Error('Expected a projected document.');
    const projected = findDocumentLayer(result.document, adjustmentId);
    expect(projected?.type).toBe('adjustment');
    if (projected?.type !== 'adjustment') return;
    expect(projected.adjustmentStack.modules.some((module) => (
      module.type === 'lt.light' && module.settings.contrast === 35
    ))).toBe(true);
  });

  it('rejects a stale Adjustment Layer identity', () => {
    const document = createImageDocument('Image', 64, 48, 'image');
    expect(() => projectAdjustmentSnapshot({
      snapshot: createDefaultAdjustments(),
      targetLayerId: createLayerId(),
      document,
      documentAdjustments: createDefaultAdjustments()
    })).toThrow('target no longer exists');
  });
});
