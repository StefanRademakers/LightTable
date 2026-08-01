import { describe, expect, it } from 'vitest';
import { StaleWorkGate } from './StaleWorkGate';

describe('StaleWorkGate', () => {
  it('rejects superseded work without coupling cancellation to a backend', () => {
    const gate = new StaleWorkGate();
    const stale = gate.begin('path');
    const current = gate.begin('path');
    expect(gate.isCurrent(stale)).toBe(false);
    expect(gate.isCurrent(current)).toBe(true);
    gate.invalidate('path');
    expect(gate.isCurrent(current)).toBe(false);
  });
});
