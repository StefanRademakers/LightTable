import { createHash } from 'node:crypto';

const secretKey = /authorization|cookie|code|secret|token|password/iu;
const redactValue = (value, key, depth, seen) => {
  if (secretKey.test(key)) return '[redacted]';
  if (depth > 8) return '[bounded]';
  if (Array.isArray(value)) return value.slice(0, 100)
    .map((entry) => redactValue(entry, '', depth + 1, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const result = Object.fromEntries(Object.entries(value).slice(0, 100)
      .map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey, depth + 1, seen)]));
    seen.delete(value); return result;
  }
  return typeof value === 'string' && value.length > 512 ? `${value.slice(0, 512)}...` : value;
};
export const redact = (value, key = '') => redactValue(value, key, 0, new WeakSet());

export const opaqueId = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

export const createStructuredLogger = ({ write = (line) => process.stdout.write(`${line}\n`) } = {}) => ({
  info(event, detail = {}) { write(JSON.stringify({ time: new Date().toISOString(), level: 'info', event, ...redact(detail) })); },
  error(event, detail = {}) { write(JSON.stringify({ time: new Date().toISOString(), level: 'error', event, ...redact(detail) })); }
});

export class PrivacyAuditLog {
  constructor({ stateStore = null, now = () => Date.now(), retentionMs = 30 * 24 * 3600_000, maxEntries = 10_000 } = {}) {
    this.stateStore = stateStore; this.now = now; this.retentionMs = retentionMs; this.maxEntries = maxEntries;
    this.entries = stateStore?.load?.()?.entries ?? []; this.prune();
  }
  append({ tenantId, userId, clientId, action, outcome = 'ok', detail = {} }) {
    this.entries.push({ time: this.now(), tenant: opaqueId(tenantId), user: opaqueId(userId),
      client: opaqueId(clientId), action: String(action).slice(0, 96), outcome, detail: redact(detail) });
    this.prune();
  }
  prune() {
    const cutoff = this.now() - this.retentionMs;
    this.entries = this.entries.filter((entry) => entry.time >= cutoff).slice(-this.maxEntries);
    this.stateStore?.save?.({ version: 1, entries: this.entries });
  }
  list(limit = 100) { return this.entries.slice(-Math.min(Math.max(limit, 1), 200)).map((entry) => ({ ...entry })); }
}

export const createRequestGuard = ({ now = () => Date.now(), windowMs = 60_000,
  maxRequests = 240, maxConcurrent = 32, maxBuckets = 10_000 } = {}) => {
  const buckets = new Map(); let active = 0;
  return (request, response, next) => {
    const key = `${request.ip ?? 'unknown'}:${request.path.startsWith('/oauth') ? 'oauth' : 'api'}`;
    if (!buckets.has(key) && buckets.size >= maxBuckets) {
      const time = now();
      for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= time) buckets.delete(bucketKey);
      if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value);
    }
    const current = buckets.get(key); const bucket = current && current.resetAt > now()
      ? current : { count: 0, resetAt: now() + windowMs };
    bucket.count += 1; buckets.set(key, bucket);
    if (bucket.count > maxRequests) return response.status(429).set('retry-after', String(Math.ceil((bucket.resetAt - now()) / 1000)))
      .json({ error: 'rate-limit' });
    if (active >= maxConcurrent) return response.status(503).json({ error: 'concurrency-limit' });
    active += 1; let released = false;
    const release = () => { if (!released) { released = true; active -= 1; } };
    response.once('finish', release); response.once('close', release); next();
  };
};

export const validateServiceConfig = (environment) => {
  const port = Number.parseInt(environment.PORT ?? '8787', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const publicUrl = new URL(environment.LIGHTTABLE_PUBLIC_URL ?? `http://127.0.0.1:${port}`);
  const insecure = environment.LIGHTTABLE_ALLOW_INSECURE_HTTP === 'true';
  if (!insecure && publicUrl.protocol !== 'https:') throw new Error('LIGHTTABLE_PUBLIC_URL must use HTTPS in production.');
  if (!environment.LIGHTTABLE_PAIRING_CODE || environment.LIGHTTABLE_PAIRING_CODE.length < 8) {
    throw new Error('LIGHTTABLE_PAIRING_CODE must contain at least 8 characters.');
  }
  if (!insecure && (!environment.LIGHTTABLE_STATE_PATH || !environment.LIGHTTABLE_STATE_SECRET)) {
    throw new Error('Production requires LIGHTTABLE_STATE_PATH and LIGHTTABLE_STATE_SECRET.');
  }
  if (environment.LIGHTTABLE_STATE_SECRET && environment.LIGHTTABLE_STATE_SECRET.length < 32) {
    throw new Error('LIGHTTABLE_STATE_SECRET must contain at least 32 characters.');
  }
  const demo = environment.LIGHTTABLE_DEMO_MODE === 'true';
  if (!demo && !environment.LIGHTTABLE_DEVICE_ID
    && (!environment.LIGHTTABLE_BRIDGE_URL || !environment.LIGHTTABLE_BRIDGE_TOKEN)) {
    throw new Error('LIGHTTABLE_DEVICE_ID or LIGHTTABLE_BRIDGE_URL and LIGHTTABLE_BRIDGE_TOKEN are required outside demo mode.');
  }
  const allowedHosts = (environment.LIGHTTABLE_ALLOWED_HOSTS ?? publicUrl.hostname)
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowedHosts.length) throw new Error('LIGHTTABLE_ALLOWED_HOSTS may not be empty.');
  return {
    port, host: environment.HOST ?? '0.0.0.0', publicUrl: publicUrl.href, insecure, demo, allowedHosts
  };
};
