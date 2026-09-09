import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import {
  addRasterLayerAttachedAdjustment,
  createAdjustmentLayer
} from '../../editor/document/documentCommands';
import {
  createAdjustmentStackFromBasicAdjustments,
  adjustmentStackForScope
} from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  resolveAdjustmentPresentation,
  resolveAdjustmentPresentationSource
} from './resolveAdjustmentPresentation';

describe('resolveAdjustmentPresentation', () => {
  it('derives the active Adjustment Layer after a stale inspector target is removed', () => {
    const opening = createImageDocument('Adjustments', 32, 24, 'asset');
    const previousLayerId = opening.activeLayerId!;
    const authored = createDefaultAdjustments();
    authored.exposureEV = 1.5;
    const document = createAdjustmentLayer(
      opening,
      adjustmentStackForScope(createAdjustmentStackFromBasicAdjustments(authored), 'adjustment-layer'),
      'Grade'
    );

    const projection = resolveAdjustmentPresentation(
      document,
      createDefaultAdjustments(),
      { kind: 'layer', layerId: previousLayerId }
    );

    expect(projection?.adjustments.exposureEV).toBe(1.5);
  });

  it('restores the previous active owner from canonical undo state', () => {
    const document = createImageDocument('Undo', 32, 24, 'asset');
    const rasterId = document.activeLayerId!;

    const projection = resolveAdjustmentPresentation(
      document,
      createDefaultAdjustments(),
      { kind: 'layer', layerId: 'deleted-adjustment' as typeof rasterId }
    );

    expect(projection?.adjustments).toEqual(createDefaultAdjustments());
  });

  it('materializes an attached owner without treating the panel as state', () => {
    const opening = createImageDocument('Attached', 32, 24, 'asset');
    const rasterId = opening.activeLayerId!;
    const authored = createDefaultAdjustments();
    authored.photoshopAdjustment.kind = 'threshold';
    authored.photoshopAdjustment.thresholdLevel = 173;
    const stack = adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(authored),
      'layer'
    );
    stack.modules.forEach((module) => { module.enabled = false; });
    const document = addRasterLayerAttachedAdjustment(opening, rasterId, {
      id: 'attached-threshold',
      adjustmentKind: 'threshold',
      name: 'Threshold',
      enabled: true,
      revision: 0,
      adjustmentStack: stack
    });

    const projection = resolveAdjustmentPresentation(
      document,
      createDefaultAdjustments(),
      { kind: 'attached-processing', layerId: rasterId, adjustmentId: 'attached-threshold' }
    );

    expect(projection?.adjustments.photoshopAdjustment).toMatchObject({
      kind: 'threshold', thresholdLevel: 173
    });
  });

  it('keeps document processing as its own canonical sidecar owner', () => {
    const document = createImageDocument('Global', 32, 24, 'asset');
    const documentAdjustments = createDefaultAdjustments();
    documentAdjustments.contrast = 32;

    const projection = resolveAdjustmentPresentation(
      document,
      documentAdjustments,
      { kind: 'document-processing', owner: 'grade' }
    );

    expect(projection).toMatchObject({ domain: 'grade' });
    expect(projection?.adjustments.contrast).toBe(32);
    expect(projection?.adjustments).not.toBe(documentAdjustments);
  });

  it('exposes a stable lightweight source for unrelated document mutations', () => {
    const document = createImageDocument('Stable', 32, 24, 'asset');
    const layerId = document.activeLayerId!;
    const adjustments = createDefaultAdjustments();
    const first = resolveAdjustmentPresentationSource(
      document, adjustments, { kind: 'layer', layerId }
    );
    const unrelatedRevision = { ...document, revision: document.revision + 1 };
    const second = resolveAdjustmentPresentationSource(
      unrelatedRevision, adjustments, { kind: 'layer', layerId }
    );
    expect(second?.key).toBe(first?.key);
    expect(second?.source).toBe(first?.source);
  });
});
