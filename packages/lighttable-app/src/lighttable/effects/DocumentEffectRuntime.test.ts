import { describe, expect, it, vi } from 'vitest';
import {
  createAdjustmentStackFromBasicAdjustments,
  type AdjustmentStack
} from '../processing/adjustmentStack';
import { createDefaultAdjustments } from '../types';
import { DocumentEffectRuntime } from './DocumentEffectRuntime';
import {
  DocumentEffectNodeRegistry,
  type DocumentEffectNodeDefinition,
  type DocumentGpuEffect
} from './documentEffectNodeRegistry';
import type { LightTableEffectStage } from './types';
import { createWarpModuleInstance } from './warp/warpTypes';

const texture = (name: string) => ({ name }) as unknown as GPUTexture;

const effect = (id: string, stage: LightTableEffectStage): DocumentGpuEffect => ({
  id,
  stage,
  encode: vi.fn((_encoder: GPUCommandEncoder, input: GPUTexture) =>
    texture(`${(input as unknown as { name: string }).name}>${id}`)),
  resize: vi.fn(),
  destroyImageResources: vi.fn(),
  destroy: vi.fn(),
  estimatedTextureBytes: vi.fn(() => 10)
});

const effectTypes = [
  ['lt.lens-distortion', 'distortion', 'source-geometry'],
  ['lt.chromatic-aberration', 'chromatic', 'source-geometry'],
  ['lt.lens-blur', 'lens-blur', 'linear-spatial'],
  ['lt.halation', 'halation', 'linear-spatial'],
  ['lt.grain', 'grain', 'display-post']
] as const;

const createRuntime = (stack = createAdjustmentStackFromBasicAdjustments(
  createDefaultAdjustments(),
  undefined,
  (() => {
    let id = 0;
    return (kind: 'stack' | 'module') => `${kind}-${id++}`;
  })()
)) => {
  const effects: DocumentGpuEffect[] = [];
  const definitions: DocumentEffectNodeDefinition[] = effectTypes.map(
    ([type, id, stage]) => ({
      type,
      stage,
      create: () => {
        const created = effect(id, stage);
        effects.push(created);
        return created;
      },
      update: vi.fn()
    })
  );
  const runtime = DocumentEffectRuntime.createFromStack(
    {
      device: {} as GPUDevice,
      sampler: {} as GPUSampler,
      vertexModule: {} as GPUShaderModule,
      callbacks: {}
    },
    stack,
    'document-creative',
    new DocumentEffectNodeRegistry(definitions)
  );
  return { runtime, effects, stack };
};

const moduleOfType = (stack: AdjustmentStack, type: string) => {
  const module = stack.modules.find((candidate) => candidate.type === type);
  if (!module) throw new Error(`Missing test module: ${type}`);
  return module;
};

describe('DocumentEffectRuntime', () => {
  it('passes authoritative serialized node settings to arbitrary effect executors', () => {
    const warp = createWarpModuleInstance('warp-node', {
      version: 1,
      opacity: 0.75,
      borderMode: 'mirror',
      topologyMode: 'protected',
      edgePinning: 0.25,
      maskLinkMode: 'linked',
      strokes: []
    });
    const create = vi.fn((
      ..._args: Parameters<DocumentEffectNodeDefinition['create']>
    ) => effect('warp', 'source-geometry'));
    const update = vi.fn((
      ..._args: Parameters<DocumentEffectNodeDefinition['update']>
    ) => undefined);
    const runtime = DocumentEffectRuntime.createFromStack(
      {
        device: {} as GPUDevice,
        sampler: {} as GPUSampler,
        vertexModule: {} as GPUShaderModule,
        callbacks: {}
      },
      { id: 'geometry-stack', revision: 0, modules: [warp] },
      'layer',
      new DocumentEffectNodeRegistry([{
        type: 'lt.warp',
        stage: 'source-geometry',
        create,
        update
      }])
    );

    expect(create.mock.calls[0]?.[1]).toEqual(warp);

    const changed = structuredClone(warp);
    changed.revision += 1;
    changed.settings.opacity = 0.5;
    runtime.setAdjustmentStack({
      id: 'geometry-stack',
      revision: 1,
      modules: [changed]
    });
    expect(update.mock.calls[0]?.[1]).toEqual(changed);
  });

  it('evaluates source geometry in serialized order', () => {
    const { runtime } = createRuntime();
    const result = runtime.encodeSourceGeometry({} as GPUCommandEncoder, texture('source'));
    expect((result as unknown as { name: string }).name).toBe('source>distortion>chromatic');
  });

  it('creates independent resources for repeated node instances', () => {
    const initial = createRuntime();
    const distortion = moduleOfType(initial.stack, 'lt.lens-distortion');
    const chromaticIndex = initial.stack.modules.findIndex(
      (module) => module.type === 'lt.chromatic-aberration'
    );
    const repeatedStack: AdjustmentStack = {
      ...initial.stack,
      modules: [
        ...initial.stack.modules.slice(0, chromaticIndex),
        { ...distortion, id: 'repeated-distortion' },
        ...initial.stack.modules.slice(chromaticIndex)
      ]
    };
    initial.runtime.destroy();

    const { runtime, effects } = createRuntime(repeatedStack);
    const result = runtime.encodeSourceGeometry({} as GPUCommandEncoder, texture('source'));

    expect((result as unknown as { name: string }).name)
      .toBe('source>distortion>distortion>chromatic');
    expect(effects.filter((current) => current.id === 'distortion')).toHaveLength(2);
  });

  it('keeps depth visualization free of halation and display grain', () => {
    const { runtime, effects } = createRuntime();
    const linear = runtime.encodeLinearSpatial(
      {} as GPUCommandEncoder,
      texture('grade'),
      { visualizeDepth: true }
    );
    const display = runtime.encodeDisplayPost({} as GPUCommandEncoder, linear, true);

    expect((display as unknown as { name: string }).name).toBe('grade>lens-blur');
    expect(effects.find((current) => current.id === 'halation')?.encode)
      .not.toHaveBeenCalled();
    expect(effects.find((current) => current.id === 'grain')?.encode)
      .not.toHaveBeenCalled();
  });

  it('rejects serialized effect order that crosses texture-domain stages', () => {
    const { runtime, stack } = createRuntime();
    const grain = moduleOfType(stack, 'lt.grain');
    const distortion = moduleOfType(stack, 'lt.lens-distortion');
    const invalidStack = {
      ...stack,
      modules: [
        grain,
        distortion,
        ...stack.modules.filter((module) => module !== grain && module !== distortion)
      ]
    };

    expect(() => runtime.setAdjustmentStack(invalidStack))
      .toThrow(/violates render-stage order/);
  });

  it('owns aggregate lifecycle and memory accounting', () => {
    const { runtime, effects } = createRuntime();
    runtime.resize(1920, 1080);
    expect(runtime.estimatedTextureBytes()).toBe(50);
    runtime.destroyImageResources();
    runtime.destroy();

    effects.forEach((current) => {
      expect(current.resize).toHaveBeenCalledWith(1920, 1080);
      expect(current.destroyImageResources).toHaveBeenCalledOnce();
      expect(current.destroy).toHaveBeenCalledOnce();
    });
  });
});
