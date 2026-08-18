import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { HiggsfieldCredentialRecord, HiggsfieldCredentialStore } from '@lighttable/genai-higgsfield';
import type { CredentialProtector } from './openArtCredentialStore';
import { atomicWriteFile } from '../atomicFileWriter';

const errorCode = (reason: unknown): string | null =>
  reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : null;

/** Main-process-only encrypted Higgsfield credential persistence. */
export class DesktopHiggsfieldCredentialStore implements HiggsfieldCredentialStore {
  constructor(private readonly filePath: string, private readonly protector: CredentialProtector) {}

  async load(): Promise<HiggsfieldCredentialRecord | null> {
    if (!this.protector.available()) return null;
    let encrypted: Uint8Array;
    try { encrypted = await readFile(this.filePath); }
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
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await atomicWriteFile({ targetPath: this.filePath, bytes: this.protector.protect(JSON.stringify(record)), validate: async () => undefined });
  }

  async clear(): Promise<void> {
    try { await unlink(this.filePath); }
    catch (reason) { if (errorCode(reason) !== 'ENOENT') throw reason; }
  }
}
