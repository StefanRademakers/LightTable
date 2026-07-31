import { describe, expect, it } from 'vitest';
import { InteractiveRefreshGate } from './interactiveRefreshGate';

describe('InteractiveRefreshGate', () => {
  it('never delays dirty work outside an interaction', () => {
    const gate = new InteractiveRefreshGate(100);
    expect(gate.shouldRefresh(0)).toBe(true);
    expect(gate.shouldRefresh(1)).toBe(true);
  });

  it('limits refreshes during an interaction', () => {
    const gate = new InteractiveRefreshGate(100);
    gate.setActive(true);
    expect(gate.shouldRefresh(10)).toBe(true);
    expect(gate.shouldRefresh(50)).toBe(false);
    expect(gate.shouldRefresh(109)).toBe(false);
    expect(gate.shouldRefresh(110)).toBe(true);
  });

  it('allows an immediate final refresh when interaction ends', () => {
    const gate = new InteractiveRefreshGate(100);
    gate.setActive(true);
    expect(gate.shouldRefresh(10)).toBe(true);
    gate.setActive(false);
    expect(gate.shouldRefresh(11)).toBe(true);
  });
});
