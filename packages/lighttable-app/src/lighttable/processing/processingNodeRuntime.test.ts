import { describe, expect, it } from 'vitest';
import type { AdjustmentStack } from './adjustmentStack';
import type { ProcessingModuleDefinition } from './moduleDefinitions';
import { ProcessingModuleRegistry } from './processingModuleRegistry';
import {
  buildProcessingPlan,
  ProcessingNodeRuntime,
  type ProcessingNodeExecutor
} from './processingNodeRuntime';

const definitions: ProcessingModuleDefinition[] = [
  {
    type: 'test.first',
    label: 'First',
    category: 'spatial',
    settingsPaths: [],
    allowedScopes: ['layer'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve'
  },
  {
    type: 'test.second',
    label: 'Second',
    category: 'spatial',
    settingsPaths: [],
    allowedScopes: ['layer', 'group'],
    inputDomain: 'linear-rgb',
    outputDomain: 'linear-rgb',
    alphaBehavior: 'preserve'
  }
];

const registry = new ProcessingModuleRegistry(definitions);
const stack = (types: string[]): AdjustmentStack => ({
  id: 'stack',
  revision: 0,
  modules: types.map((type, index) => ({
    id: `node-${index}`,
    type,
    enabled: true,
    revision: 0,
    settings: {}
  }))
});

describe('buildProcessingPlan', () => {
  it('preserves serialized order and repeated node types', () => {
    const plan = buildProcessingPlan(
      stack(['test.second', 'test.first', 'test.second']),
      { registry, scope: 'layer' }
    );

    expect(plan.steps.map(({ instance }) => instance.type)).toEqual([
      'test.second',
      'test.first',
      'test.second'
    ]);
  });

  it('reports disabled, unknown and out-of-scope nodes explicitly', () => {
    const candidate = stack(['test.first', 'missing', 'test.second']);
    candidate.modules[0]!.enabled = false;
    const plan = buildProcessingPlan(candidate, { registry, scope: 'group' });

    expect(plan.steps.map(({ instance }) => instance.type)).toEqual(['test.second']);
    expect(plan.skipped.map(({ reason }) => reason)).toEqual([
      'disabled',
      'unknown-module'
    ]);
  });
});

describe('ProcessingNodeRuntime', () => {
  const executor = (type: string): ProcessingNodeExecutor<string, string[]> => ({
    type,
    encode(context, input, instance) {
      context.push(instance.id);
      return `${input}>${type}`;
    }
  });

  it('executes nodes in document order and returns the explicit plan', () => {
    const runtime = new ProcessingNodeRuntime(
      [executor('test.first'), executor('test.second')],
      registry
    );
    const trace: string[] = [];
    const result = runtime.execute(
      stack(['test.second', 'test.first']),
      'source',
      trace,
      'layer'
    );

    expect(result.output).toBe('source>test.second>test.first');
    expect(trace).toEqual(['node-0', 'node-1']);
  });

  it('fails loudly when an enabled installed node has no executor', () => {
    const runtime = new ProcessingNodeRuntime([executor('test.first')], registry);
    expect(() => runtime.execute(
      stack(['test.second']),
      'source',
      [],
      'layer'
    )).toThrow('No processing executor is registered for enabled node: test.second');
  });

  it('rejects duplicate and undefined executor registrations', () => {
    expect(() => new ProcessingNodeRuntime(
      [executor('test.first'), executor('test.first')],
      registry
    )).toThrow('Duplicate processing executor type: test.first');
    expect(() => new ProcessingNodeRuntime(
      [executor('not-defined')],
      registry
    )).toThrow('Processing executor has no module definition: not-defined');
  });
});
