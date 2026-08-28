import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { HiggsfieldCredentialRecord, HiggsfieldCredentialStore } from '@lighttable/genai-higgsfield';
import type { CredentialProtector } from './openArtCredentialStore';
import { atomicWriteFile } from '../atomicFileWriter';
import { stat } from 'node:fs/promises';

const MAX_CREDENTIAL_BYTES = 1024 * 1024;

const errorCode = (reason: unknown): string | null =>
  reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : null;

/** Main-process-only encrypted Higgsfield credential persistence. */
export class DesktopHiggsfieldCredentialStore implements HiggsfieldCredentialStore {
  constructor(private readonly filePath: string, private readonly protector: CredentialProtector) {}

  async load(): Promise<HiggsfieldCredentialRecord | null> {
    if (!this.protector.available()) return null;
    let encrypted: Uint8Array;
    try {
      const info = await stat(this.filePath);
      if (!info.isFile() || info.size < 1 || info.size > MAX_CREDENTIAL_BYTES) {
        throw new Error('Higgsfield credential record exceeds the storage boundary.');
      }
      encrypted = await readFile(this.filePath);
      if (encrypted.byteLength !== info.size) throw new Error('Higgsfield credential record changed while reading.');
    }
    catch (reason) { if (errorCode(reason) === 'ENOENT') return null; throw reason; }
    try {
      const value = JSON.parse(this.protector.unprotect(encrypted));
      if (!value || typeof value !== 'object' || !('clients' in value) || !('tokens' in value)) {
        throw new Error('Invalid Higgsfield credential record.');
      }
      return value as HiggsfieldCredentialRecord;
    } catch {
      await this.clear();
      return null;
    }
  }

  async save(record: HiggsfieldCredentialRecord): Promise<void> {
    if (!this.protector.available()) throw new Error('Secure credential storage is unavailable on this system.');
    const bytes = this.protector.protect(JSON.stringify(record));
    if (bytes.byteLength > MAX_CREDENTIAL_BYTES) {
      throw new Error('Higgsfield credential record exceeds the storage boundary.');
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await atomicWriteFile({ targetPath: this.filePath, bytes, validate: async () => undefined });
  }

  async clear(): Promise<void> {
    try { await unlink(this.filePath); }
    catch (reason) { if (errorCode(reason) !== 'ENOENT') throw reason; }
  }
}
