import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { MemoryStateStore } from '../src/durableState.mjs';
import { createRequestGuard, createStructuredLogger, PrivacyAuditLog, redact, validateServiceConfig } from '../src/operations.mjs';

test('production config requires TLS, durable encrypted state and bridge credentials', () => {
  const base = { LIGHTTABLE_PUBLIC_URL: 'https://agent.example', LIGHTTABLE_PAIRING_CODE: 'pair-12345678',
    LIGHTTABLE_STATE_PATH: '/var/lib/lighttable/state', LIGHTTABLE_STATE_SECRET: 's'.repeat(64),
    LIGHTTABLE_BRIDGE_URL: 'http://127.0.0.1:49152', LIGHTTABLE_BRIDGE_TOKEN: 't'.repeat(32) };
  assert.equal(validateServiceConfig(base).publicUrl, 'https://agent.example/');
  assert.throws(() => validateServiceConfig({ ...base, LIGHTTABLE_PUBLIC_URL: 'http://agent.example' }), /HTTPS/u);
  assert.throws(() => validateServiceConfig({ ...base, LIGHTTABLE_STATE_SECRET: '' }), /STATE/u);
  assert.throws(() => validateServiceConfig({ ...base, LIGHTTABLE_BRIDGE_TOKEN: '' }), /BRIDGE/u);
});

test('structured logs and bounded audit records never retain credentials or raw identities', () => {
  const lines = []; const logger = createStructuredLogger({ write: (line) => lines.push(line) });
  logger.info('request', { authorization: 'Bearer secret', nested: { token: 'secret' }, safe: 'ok' });
  assert.equal(lines.join('').includes('Bearer secret'), false);
  assert.deepEqual(redact({ password: 'secret', safe: true }), { password: '[redacted]', safe: true });
  const stateStore = new MemoryStateStore(); const audit = new PrivacyAuditLog({ stateStore, maxEntries: 2 });
  for (let index = 0; index < 3; index += 1) audit.append({ tenantId: 'tenant@example', userId: 'user@example',
    clientId: `client-${index}`, action: 'design.edit', detail: { token: 'never-store-me' } });
  const entries = audit.list();
  assert.equal(entries.length, 2); assert.equal(JSON.stringify(entries).includes('tenant@example'), false);
  assert.equal(JSON.stringify(entries).includes('never-store-me'), false);
});

test('hostile audit values and request identities remain bounded', () => {
  const circular = { token: 'secret', children: [] }; circular.self = circular;
  circular.children = Array.from({ length: 1_000 }, (_, index) => ({ index, value: 'x'.repeat(1_000) }));
  const safe = redact(circular);
  assert.equal(safe.self, '[circular]'); assert.equal(safe.token, '[redacted]');
  assert.equal(safe.children.length, 100); assert.ok(JSON.stringify(safe).length < 60_000);

  let time = 0; const guard = createRequestGuard({ now: () => time, maxRequests: 2,
    maxConcurrent: 1, maxBuckets: 2, windowMs: 100 });
  const response = () => Object.assign(new EventEmitter(), {
    statusCode: 200, status(code) { this.statusCode = code; return this; },
    set() { return this; }, json(value) { this.value = value; this.emit('finish'); return this; }
  });
  const first = response(); let entered = 0;
  guard({ ip: '1', path: '/mcp' }, first, () => { entered += 1; });
  const concurrent = response(); guard({ ip: '2', path: '/mcp' }, concurrent, () => { entered += 1; });
  assert.equal(concurrent.statusCode, 503); first.emit('finish');
  const second = response(); guard({ ip: '1', path: '/mcp' }, second, () => { entered += 1; }); second.emit('finish');
  const limited = response(); guard({ ip: '1', path: '/mcp' }, limited, () => { entered += 1; });
  assert.equal(limited.statusCode, 429); assert.equal(entered, 2);
  time = 101; const recycled = response(); guard({ ip: '3', path: '/mcp' }, recycled, () => { entered += 1; });
  assert.equal(entered, 3); recycled.emit('finish');
});
