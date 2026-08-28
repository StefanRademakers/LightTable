import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { OpenArtCredentialRecord, OpenArtCredentialStore } from '@lighttable/genai-openart';
import { atomicWriteFile } from '../atomicFileWriter';
import { stat } from 'node:fs/promises';

const MAX_CREDENTIAL_BYTES = 1024 * 1024;

export interface CredentialProtector {
  available(): boolean;
  protect(value: string): Uint8Array;
  unprotect(value: Uint8Array): string;
}

const errorCode = (reason: unknown): string | null =>
  reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : null;

/** Main-process-only encrypted OpenArt credential persistence. */
export class DesktopOpenArtCredentialStore implements OpenArtCredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly protector: CredentialProtector
  ) {}

  async load(): Promise<OpenArtCredentialRecord | null> {
    if (!this.protector.available()) return null;
    let encrypted: Uint8Array;
    try {
      const info = await stat(this.filePath);
      if (!info.isFile() || info.size < 1 || info.size > MAX_CREDENTIAL_BYTES) {
        throw new Error('OpenArt credential record exceeds the storage boundary.');
      }
      encrypted = await readFile(this.filePath);
      if (encrypted.byteLength !== info.size) throw new Error('OpenArt credential record changed while reading.');
    } catch (reason) {
      if (errorCode(reason) === 'ENOENT') return null;
      throw reason;
    }
    try {
      const value = JSON.parse(this.protector.unprotect(encrypted));
      if (!value || typeof value !== 'object'
        || !('clients' in value) || typeof value.clients !== 'object'
        || !('tokens' in value) || typeof value.tokens !== 'object') {
        throw new Error('Invalid OpenArt credential record.');
      }
      return value as OpenArtCredentialRecord;
    } catch {
      // A DPAPI/keychain change or interrupted legacy write makes the session
      // permanently unusable. Removing only this encrypted provider record
      // lets the normal authorization flow recover without exposing crypto
      // implementation details in the renderer.
      await this.clear();
      return null;
    }
  }

  async save(record: OpenArtCredentialRecord): Promise<void> {
    if (!this.protector.available()) {
      throw new Error('Secure credential storage is unavailable on this system.');
    }
    const bytes = this.protector.protect(JSON.stringify(record));
    if (bytes.byteLength > MAX_CREDENTIAL_BYTES) {
      throw new Error('OpenArt credential record exceeds the storage boundary.');
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await atomicWriteFile({
      targetPath: this.filePath,
      bytes,
      validate: async () => undefined
    });
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (reason) {
      if (errorCode(reason) !== 'ENOENT') throw reason;
    }
  }
}
