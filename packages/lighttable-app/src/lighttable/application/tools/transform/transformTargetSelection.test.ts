import { describe, expect, it } from 'vitest';
import type { LayerId } from '../../../editor/document/documentTypes';
import { resolveTransformTargetLayerIds } from './transformTargetSelection';

const id = (value: string) => value as LayerId;

describe('transform target selection', () => {
  it('rejects a stale panel selection after canonical shape creation', () => {
    expect(resolveTransformTargetLayerIds(id('shape'), [id('pasted-raster')]))
      .toEqual([id('shape')]);
  });

  it('preserves an intentional multi-selection containing the active layer', () => {
    expect(resolveTransformTargetLayerIds(id('shape'), [id('raster'), id('shape')]))
      .toEqual([id('raster'), id('shape')]);
  });

  it('deduplicates targets and returns no target without an active layer', () => {
    expect(resolveTransformTargetLayerIds(id('shape'), [id('shape'), id('shape')]))
      .toEqual([id('shape')]);
    expect(resolveTransformTargetLayerIds(null, [id('shape')])).toEqual([]);
  });
});
