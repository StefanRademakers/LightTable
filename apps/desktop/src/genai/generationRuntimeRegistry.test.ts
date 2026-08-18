import { describe, expect, it, vi } from 'vitest';
import { GenerationRuntimeRegistry } from './generationRuntimeRegistry';

describe('GenerationRuntimeRegistry', () => {
  it('keeps provider runtimes additive and explicit', () => {
    const registry = new GenerationRuntimeRegistry();
    const runtime = { providerId: 'higgsfield', prepare: vi.fn(), submit: vi.fn(), wait: vi.fn() } as never;
    registry.register(runtime);
    expect(registry.runtime('higgsfield' as never)).toBe(runtime);
    expect(() => registry.register(runtime)).toThrow(/already registered/u);
  });
});
