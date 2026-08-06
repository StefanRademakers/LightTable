import { describe, expect, it } from 'vitest';
import {
  betaEventFromDebugMessage,
  bucketBetaDuration,
  createLocalBetaDiagnosticRecorder,
  LOCAL_BETA_EVENT_LIMIT
} from './localBetaDiagnostics';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    dump: () => JSON.stringify([...values])
  };
};

describe('local beta diagnostics', () => {
  it('is off by default, records only after opt-in and erases events on revoke', () => {
    const storage = memoryStorage();
    const recorder = createLocalBetaDiagnosticRecorder(storage, () => Date.UTC(2026, 7, 6, 22, 51));
    expect(recorder.record({ kind: 'runtime-stop', workflow: 'edit' })).toBe(false);
    recorder.setEnabled(true);
    expect(recorder.record({ kind: 'runtime-stop', workflow: 'edit' })).toBe(true);
    expect(recorder.snapshot()).toMatchObject({ enabled: true, events: [{ atHour: '2026-08-06T22:00:00.000Z' }] });
    recorder.setEnabled(false);
    expect(recorder.snapshot()).toEqual({ schemaVersion: 1, localOnly: true, enabled: false, events: [] });
    expect(storage.dump()).not.toContain('runtime-stop');
  });

  it('keeps a bounded enum-only history without hostile source data', () => {
    const storage = memoryStorage();
    const recorder = createLocalBetaDiagnosticRecorder(storage);
    recorder.setEnabled(true);
    const hostile = 'D:\\Clients\\secret.psd Bearer abc pairing-token=123 MCP prompt PRIVATE';
    for (let id = 0; id < 500; id += 1) {
      const event = betaEventFromDebugMessage({ id, timestamp: id, severity: 'error', source: 'PSD import', message: hostile });
      if (event) recorder.record(event);
    }
    expect(recorder.snapshot().events).toHaveLength(LOCAL_BETA_EVENT_LIMIT);
    expect(storage.dump()).not.toContain('Clients');
    expect(storage.dump()).not.toContain('secret.psd');
    expect(storage.dump()).not.toContain('PRIVATE');
    expect(storage.dump()).not.toContain('abc');
  });

  it('uses stable interaction-duration buckets', () => {
    expect([0, 16, 34, 101, 501].map(bucketBetaDuration))
      .toEqual(['under-16ms', '16-33ms', '34-100ms', '101-500ms', 'over-500ms']);
  });

  it('reconstructs persisted events from allowed fields and drops injected content', () => {
    const storage = memoryStorage();
    storage.setItem('lighttable.beta-diagnostics.enabled.v1', 'true');
    storage.setItem('lighttable.beta-diagnostics.events.v1', JSON.stringify([{
      kind: 'runtime-stop', atHour: '2026-08-06T22:00:00.000Z', workflow: 'edit',
      fileName: 'secret.psd', prompt: 'PRIVATE MCP DATA'
    }]));
    const snapshot = createLocalBetaDiagnosticRecorder(storage).snapshot();
    expect(snapshot.events).toEqual([{
      kind: 'runtime-stop', atHour: '2026-08-06T22:00:00.000Z', workflow: 'edit'
    }]);
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
  });
});
