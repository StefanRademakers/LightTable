import { describe, expect, it } from 'vitest';
import { createAdjustmentStackFromBasicAdjustments } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import {
  addWarpNodeToStack,
  createDefaultWarpNodeSettings,
  createWarpModuleInstance,
  readWarpNodeSettings,
  setWarpNodeSettings
} from './warpTypes';

describe('Warp node document model', () => {
  it('is opt-in and is not synthesized by the legacy adjustment bridge', () => {
    const stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    expect(stack.modules.some((node) => node.type === 'lt.warp')).toBe(false);
  });

  it('persists at the source-geometry boundary without changing other node order', () => {
    const stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const node = createWarpModuleInstance('warp');
    const next = addWarpNodeToStack(stack, node);

    expect(next.modules[0]?.type).toBe('lt.warp');
    expect(next.modules.slice(1).map(({ id }) => id)).toEqual(stack.modules.map(({ id }) => id));
    expect(readWarpNodeSettings(next.modules[0]!)).toEqual(createDefaultWarpNodeSettings());
  });

  it('rejects invalid persisted settings instead of silently bypassing them', () => {
    expect(() => readWarpNodeSettings({
      ...createWarpModuleInstance('warp'),
      settings: { version: 99, strokes: [] }
    })).toThrow('Invalid lt.warp settings');
  });

  it('updates only the addressed Warp node when a stack contains repeated types', () => {
    const first = createWarpModuleInstance('warp-first');
    const second = createWarpModuleInstance('warp-second');
    const stack = {
      id: 'stack',
      revision: 3,
      modules: [first, second]
    };
    const settings = {
      ...createDefaultWarpNodeSettings(),
      borderMode: 'mirror' as const
    };

    const next = setWarpNodeSettings(stack, settings, second.id);

    expect(next.modules[0]).toEqual(first);
    expect(readWarpNodeSettings(next.modules[1]!)).toEqual(settings);
    expect(next.modules[1]!.revision).toBe(second.revision + 1);
  });

});
