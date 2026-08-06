import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const FORMAT = 'lighttable-encrypted-state-v1';
const deriveKey = (secret) => createHash('sha256').update(secret).digest();

export class MemoryStateStore {
  constructor(initial = null) { this.value = initial; }
  load() { return this.value === null ? null : structuredClone(this.value); }
  save(value) { this.value = structuredClone(value); }
}

export class EncryptedJsonFileStore {
  constructor({ path, secret }) {
    if (!path) throw new Error('A durable state path is required.');
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new Error('LIGHTTABLE_STATE_SECRET must contain at least 32 characters.');
    }
    this.path = resolve(path); this.key = deriveKey(secret);
    mkdirSync(dirname(this.path), { recursive: true });
  }

  load() {
    if (!existsSync(this.path)) return null;
    const envelope = JSON.parse(readFileSync(this.path, 'utf8'));
    if (envelope.format !== FORMAT) throw new Error('Unsupported durable state format.');
    const iv = Buffer.from(envelope.iv, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const clear = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64url')), decipher.final()]);
    return JSON.parse(clear.toString('utf8'));
  }

  save(value) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({ format: FORMAT, iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') });
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try { writeFileSync(temporary, envelope, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path); }
    finally { rmSync(temporary, { force: true }); }
  }
}
