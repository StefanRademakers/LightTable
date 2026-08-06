import { describe, expect, it } from 'vitest';
import { createLocalLightTableFunnelTelemetry } from './LightTableFunnelTelemetry';

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values
  };
};

describe('local onboarding funnel telemetry', () => {
  it('is absent by default and records only after explicit opt-in', () => {
    const local = storage();
    const funnel = createLocalLightTableFunnelTelemetry(local, () => 42);
    funnel.record('launcher.viewed');
    expect(local.values.size).toBe(0);
    funnel.setEnabled(true);
    funnel.record('guide.started');
    expect([...local.values.values()].join(' ')).toContain('guide.started');
  });

  it('is bounded and opt-out erases the local event history', () => {
    const local = storage();
    const funnel = createLocalLightTableFunnelTelemetry(local, () => 42);
    funnel.setEnabled(true);
    for (let index = 0; index < 140; index += 1) funnel.record('guide.shape-created');
    const events = JSON.parse([...local.values.entries()].find(([key]) => key.includes('.events.'))![1]);
    expect(events).toHaveLength(100);
    funnel.setEnabled(false);
    expect(local.values.size).toBe(0);
  });

  it('never throws when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('offline'); }, setItem: () => { throw new Error('offline'); }, removeItem: () => { throw new Error('offline'); } };
    const funnel = createLocalLightTableFunnelTelemetry(broken);
    expect(funnel.enabled()).toBe(false);
    expect(() => funnel.setEnabled(true)).not.toThrow();
    expect(() => funnel.record('launcher.viewed')).not.toThrow();
  });
});
