import { describe, expect, it } from 'vitest';
import { LIGHTTABLE_COMMAND_SCHEMAS, validateJsonSchemaValue } from '@lighttable/command-contract';
import { createDefaultLayerStyle, createDefaultLayerStyleStack } from '../../editor/styles/layerStyleDefaults';
import { observedLayerStyleCommands } from './semanticLayerStyleObservation';

describe('semantic Layer Style observation', () => {
  it('projects one local checkpoint into bounded replayable effect operations', () => {
    const shadow = createDefaultLayerStyle('drop-shadow');
    const overlay = createDefaultLayerStyle('color-overlay');
    const stroke = createDefaultLayerStyle('stroke');
    const before = { ...createDefaultLayerStyleStack(), effects: [shadow, overlay] };
    const after = { ...structuredClone(before), scale: 1.5, effects: [
      stroke,
      { ...structuredClone(shadow), enabled: false, distance: 16, size: 24 }
    ], revision: before.revision + 1 };

    const operations = observedLayerStyleCommands('title', before, after);

    expect(operations.map(({ command }) => command)).toEqual([
      'layer.style.update', 'layer.effect.remove', 'layer.effect.add',
      'layer.effect.setEnabled', 'layer.effect.update', 'layer.effect.move'
    ]);
    expect(operations.find(({ command }) => command === 'layer.effect.update')?.parameters)
      .toEqual({ layerId: 'title', effectId: shadow.id, settings: { distance: 16, size: 24 } });
    expect(operations.find(({ command }) => command === 'layer.effect.add')?.parameters)
      .toMatchObject({ layerId: 'title', effectKind: 'stroke', settings: {
        size: 3, position: 'outside', fill: { type: 'color' }
      } });
    for (const operation of operations) {
      const schema = LIGHTTABLE_COMMAND_SCHEMAS[operation.command]!;
      expect(validateJsonSchemaValue(schema.input, operation.parameters), operation.command)
        .toEqual({ valid: true, issues: [] });
      expect(validateJsonSchemaValue(schema.result, operation.result), operation.command)
        .toEqual({ valid: true, issues: [] });
      expect(JSON.stringify(operation)).not.toMatch(/pointer|preview|draft/i);
    }
  });

  it('publishes no operation for presentation-identical stacks', () => {
    const stack = createDefaultLayerStyleStack();
    expect(observedLayerStyleCommands('layer', stack, structuredClone(stack))).toEqual([]);
  });
});
