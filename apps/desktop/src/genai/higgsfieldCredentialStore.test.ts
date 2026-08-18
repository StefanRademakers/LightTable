import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopHiggsfieldCredentialStore } from './higgsfieldCredentialStore';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('DesktopHiggsfieldCredentialStore', () => {
  it('persists only protected bytes and restores the provider-scoped record', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-higgsfield-'));
    roots.push(root);
    const filePath = path.join(root, 'credentials.bin');
    const protector = {
      available: () => true,
      protect: (value: string) => Uint8Array.from(new TextEncoder().encode(value), (byte) => byte ^ 0x5a),
      unprotect: (value: Uint8Array) => new TextDecoder().decode(Uint8Array.from(value, (byte) => byte ^ 0x5a))
    };
    const store = new DesktopHiggsfieldCredentialStore(filePath, protector);
    const record = { clients: {}, tokens: { issuer: { access_token: 'secret', token_type: 'Bearer' as const } } };
    await store.save(record);
    expect(new TextDecoder().decode(await readFile(filePath))).not.toContain('access_token');
    await expect(store.load()).resolves.toEqual(record);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('fails closed when system encryption is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-higgsfield-'));
    roots.push(root);
    const store = new DesktopHiggsfieldCredentialStore(path.join(root, 'credentials.bin'), {
      available: () => false, protect: () => new Uint8Array(), unprotect: () => ''
    });
    await expect(store.save({ clients: {}, tokens: {} })).rejects.toThrow('unavailable');
  });
});
