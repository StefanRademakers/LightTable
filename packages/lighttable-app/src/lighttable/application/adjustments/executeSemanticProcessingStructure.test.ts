import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  adjustmentStackGradeGroupIsEnabled,
  adjustmentStackHasLocalProcessing,
  adjustmentStackLocalProcessingIsEnabled
} from '../../processing/adjustmentStack';
import { executeSemanticProcessingStructure } from './executeSemanticProcessingStructure';

describe('executeSemanticProcessingStructure', () => {
  it('owns the complete local-processing enable and remove lifecycle', () => {
    let document = createRasterLayer(createImageDocument('Processing', 64, 64, 'source'));
    const layerId = document.activeLayerId!;
    const execute = (command: Parameters<typeof executeSemanticProcessingStructure>[0]) => (
      executeSemanticProcessingStructure(command, {
        changeDocument: (change) => {
          const next = change(document);
          if (next === document) return false;
          document = next;
          return true;
        }
      })
    );

    expect(execute({
      operation: 'set-enabled', target: { kind: 'local', layerId, owner: 'curves' }, enabled: false
    })).toMatchObject({ changed: true });
    let layer = findDocumentLayer(document, layerId);
    expect(layer?.type).toBe('raster');
    if (layer?.type !== 'raster' || !layer.adjustmentStack) throw new Error('Missing local stack.');
    expect(adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'curves')).toBe(true);
    expect(adjustmentStackLocalProcessingIsEnabled(layer.adjustmentStack, 'curves')).toBe(false);

    expect(execute({
      operation: 'remove', target: { kind: 'local', layerId, owner: 'curves' }
    })).toMatchObject({ changed: true });
    layer = findDocumentLayer(document, layerId);
    expect(layer?.type === 'raster'
      ? adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'curves')
      : true).toBe(false);
  });

  it('materializes and toggles one grade group without replacing document ownership', () => {
    let document: ImageDocument = createRasterLayer(
      createImageDocument('Grade', 64, 64, 'source')
    );
    const layerId = document.activeLayerId!;
    const originalLayer = findDocumentLayer(document, layerId);
    const result = executeSemanticProcessingStructure({
      operation: 'set-grade-group-enabled',
      target: { kind: 'layer', layerId },
      group: 'light',
      enabled: false
    }, {
      changeDocument: (change) => {
        const next = change(document);
        if (next === document) return false;
        document = next;
        return true;
      }
    });

    expect(result).toMatchObject({ changed: true });
    const layer = findDocumentLayer(document, layerId);
    expect(layer).not.toBe(originalLayer);
    expect(layer?.type === 'raster'
      ? adjustmentStackGradeGroupIsEnabled(layer.adjustmentStack, 'light')
      : true).toBe(false);

    const settledDocument = document;
    const repeated = executeSemanticProcessingStructure({
      operation: 'set-grade-group-enabled',
      target: { kind: 'layer', layerId },
      group: 'light',
      enabled: false
    }, {
      changeDocument: (change) => {
        const next = change(document);
        if (next === document) return false;
        document = next;
        return true;
      }
    });
    expect(repeated).toMatchObject({ changed: false });
    expect(document).toBe(settledDocument);
  });

  it('treats an implicitly enabled neutral grade group as an identity-preserving no-op', () => {
    let document = createRasterLayer(createImageDocument('Neutral', 64, 64, 'source'));
    const opening = document;
    const result = executeSemanticProcessingStructure({
      operation: 'set-grade-group-enabled',
      target: { kind: 'layer', layerId: document.activeLayerId! },
      group: 'color',
      enabled: true
    }, {
      changeDocument: (change) => {
        const next = change(document);
        if (next === document) return false;
        document = next;
        return true;
      }
    });

    expect(result).toMatchObject({ changed: false });
    expect(document).toBe(opening);
  });
});
