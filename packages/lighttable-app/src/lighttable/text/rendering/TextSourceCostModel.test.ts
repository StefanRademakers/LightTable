import { describe, expect, it } from 'vitest';
import { TextSourceCostModel } from './TextSourceCostModel';

const input = (change: Partial<Parameters<TextSourceCostModel['decide']>[0]> = {}) => ({
  glyphCount: 24,
  pixelCount: 20_000,
  byteLength: 160_000,
  expectedRecompositions: 1,
  availableCacheBytes: 64 * 1024 * 1024,
  directEligible: true,
  ...change
});

describe('text source cost model', () => {
  it('keeps one-off simple text on the atlas path', () => {
    const model = new TextSourceCostModel();
    expect(model.decide(input())).toMatchObject({
      mode: 'atlas', reason: 'lower-estimated-cost', measurementCount: 0
    });
  });

  it('caches only when repeated composition repays its build cost', () => {
    const model = new TextSourceCostModel();
    const decision = model.decide(input({ expectedRecompositions: 30 }));
    expect(decision.mode).toBe('cached');
    expect(decision.estimatedSavingsMs).toBeGreaterThan(0.1);
  });

  it('uses direct atlas composition when the cache cannot fit its byte budget', () => {
    const model = new TextSourceCostModel();
    expect(model.decide(input({
      expectedRecompositions: 100,
      availableCacheBytes: 159_999
    }))).toMatchObject({ mode: 'atlas', reason: 'budget' });
  });

  it('forces a texture for semantics the direct compositor cannot preserve', () => {
    const model = new TextSourceCostModel();
    expect(model.decide(input({ directEligible: false }))).toMatchObject({
      mode: 'cached', reason: 'direct-ineligible'
    });
  });

  it('incorporates normalized runtime measurements and reports decisions', () => {
    const model = new TextSourceCostModel();
    for (let index = 0; index < 8; index += 1) {
      model.observe({ phase: 'atlas-composite', durationMs: 4, glyphCount: 24, pixelCount: 20_000 });
      model.observe({ phase: 'cache-build', durationMs: 0.2, glyphCount: 24, pixelCount: 20_000 });
      model.observe({ phase: 'cached-composite', durationMs: 0.03, glyphCount: 24, pixelCount: 20_000 });
    }
    expect(model.decide(input({ expectedRecompositions: 2 })).mode).toBe('cached');
    expect(model.snapshot()).toMatchObject({
      measurementCount: 24,
      decisions: { atlas: 0, cached: 1 },
      lastDecision: { mode: 'cached', measurementCount: 24 }
    });
  });

  it('rejects invalid work units instead of producing NaN policy', () => {
    const model = new TextSourceCostModel();
    expect(() => model.decide(input({ glyphCount: 0 }))).toThrow(/glyphCount/);
    expect(() => model.observe({
      phase: 'atlas-composite', durationMs: Number.NaN, glyphCount: 1, pixelCount: 1
    })).toThrow(/durationMs/);
  });
});
