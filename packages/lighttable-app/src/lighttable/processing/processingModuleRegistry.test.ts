import { describe, expect, it } from 'vitest';
import {
  ProcessingModuleRegistry,
  currentProcessingModuleRegistry
} from './processingModuleRegistry';
import type { ProcessingModuleDefinition } from './moduleDefinitions';

const definition = (
  type: string,
  settingsPath: ProcessingModuleDefinition['settingsPaths'][number]
): ProcessingModuleDefinition => ({
  type,
  label: type,
  category: 'color',
  settingsPaths: [settingsPath],
  allowedScopes: ['layer'],
  inputDomain: 'linear-rgb',
  outputDomain: 'linear-rgb',
  alphaBehavior: 'preserve'
});

describe('ProcessingModuleRegistry', () => {
  it('preserves declared order and resolves scope support', () => {
    expect(currentProcessingModuleRegistry.definitions()[0]?.type).toBe('lt.white-balance');
    expect(currentProcessingModuleRegistry.allows('lt.grain', 'document-output')).toBe(true);
    expect(currentProcessingModuleRegistry.allows('lt.grain', 'layer')).toBe(false);
  });

  it('rejects duplicate stable types', () => {
    expect(() => new ProcessingModuleRegistry([
      definition('duplicate', 'temperature'),
      definition('duplicate', 'tint')
    ])).toThrow('Duplicate processing module type');
  });

  it('rejects ambiguous settings-path ownership', () => {
    expect(() => new ProcessingModuleRegistry([
      definition('first', 'temperature'),
      definition('second', 'temperature')
    ])).toThrow('owned by both');
  });
});
