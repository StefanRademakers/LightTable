import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TTL_MS = 15 * 60_000;
const SAFE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const relayFile = /^lt-ref-[a-f\d-]{36}\.(?:bin|part)$/u;

const safeName = (value) => path.basename(String(value ?? 'reference.bin'))
  .replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 120) || 'reference.bin';
const equal = (left, right) => {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};

export class ReferenceAssetRelay {
  constructor({ rootPath, publicUrl, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!rootPath) throw new Error('Reference relay storage path is required.');
    this.rootPath = path.resolve(rootPath); this.publicUrl = new URL(publicUrl);
    this.now = now; this.ttlMs = ttlMs; this.records = new Map();
  }

  async initialize() {
    await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.rootPath, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isFile() && relayFile.test(entry.name))
      .map((entry) => rm(path.join(this.rootPath, entry.name), { force: true })));
  }

  installRoutes(app, authenticate) {
    app.put('/genai/references', async (request, response) => {
      const session = authenticate(request);
      if (!session) return response.status(401).json({ error: 'invalid-session' });
      const mediaType = String(request.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const length = Number(request.get('content-length'));
      if (!SAFE_MEDIA_TYPES.has(mediaType)) return response.status(415).json({ error: 'unsupported-media-type' });
      if (!Number.isFinite(length) || length < 1 || length > MAX_BYTES) {
        return response.status(413).json({ error: 'reference-size-limit' });
      }
      const id = randomUUID(); const token = randomBytes(32).toString('base64url');
      const partPath = path.join(this.rootPath, `lt-ref-${id}.part`);
      const filePath = path.join(this.rootPath, `lt-ref-${id}.bin`);
      let bytes = 0;
      const limiter = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        done(bytes > MAX_BYTES ? new Error('reference-size-limit') : null, chunk);
      } });
      try {
        await pipeline(request, limiter, createWriteStream(partPath, { flags: 'wx', mode: 0o600 }));
        if (bytes !== length) throw new Error('reference-length-mismatch');
        await rename(partPath, filePath);
      } catch (reason) {
        await rm(partPath, { force: true }); await rm(filePath, { force: true });
        return response.status(reason instanceof Error && reason.message === 'reference-size-limit' ? 413 : 400)
          .json({ error: reason instanceof Error ? reason.message : 'reference-upload-failed' });
      }
      const expiresAt = Math.min(this.now() + this.ttlMs, session.expiresAt);
      const name = safeName(request.get('x-lighttable-file-name'));
      this.records.set(id, { id, tokenHash: createHash('sha256').update(token).digest('hex'), filePath,
        mediaType, name, bytes, deviceId: session.deviceId, expiresAt });
      const url = new URL(`/genai/references/${id}/${encodeURIComponent(name)}`, this.publicUrl);
      url.searchParams.set('token', token);
      return response.status(201).set('cache-control', 'no-store').json({ url: url.href, mediaType, expiresAt });
    });
    app.get('/genai/references/:id/:name', async (request, response) => {
      const record = this.records.get(request.params.id);
      const suppliedHash = createHash('sha256').update(String(request.query.token ?? '')).digest('hex');
      if (!record || record.expiresAt <= this.now() || !equal(record.tokenHash, suppliedHash)) {
        if (record?.expiresAt <= this.now()) await this.remove(record.id);
        return response.status(404).end();
      }
      try {
        const file = await stat(record.filePath);
        response.status(200).set({
          'content-type': record.mediaType, 'content-length': String(file.size),
          'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
          'content-disposition': `inline; filename="${record.name.replaceAll('"', '')}"`
        });
        createReadStream(record.filePath).on('error', () => response.destroy()).pipe(response);
      } catch { this.records.delete(record.id); response.status(404).end(); }
    });
  }

  async remove(id) {
    const record = this.records.get(id); this.records.delete(id);
    if (record) await rm(record.filePath, { force: true });
  }

  async close() {
    await Promise.all([...this.records.keys()].map((id) => this.remove(id)));
  }
}
