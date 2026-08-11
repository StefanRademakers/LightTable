import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopOpenArtCredentialStore } from './openArtCredentialStore';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DesktopOpenArtCredentialStore', () => {
  it('persists only protected bytes and restores the record', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-openart-'));
    roots.push(root);
    const filePath = path.join(root, 'credentials.bin');
    const protector = {
      available: () => true,
      protect: (value: string) => Uint8Array.from(
        new TextEncoder().encode(value), (byte) => byte ^ 0x5a
      ),
      unprotect: (value: Uint8Array) => new TextDecoder().decode(
        Uint8Array.from(value, (byte) => byte ^ 0x5a)
      )
    };
    const store = new DesktopOpenArtCredentialStore(filePath, protector);
    const record = {
      clients: {},
      tokens: { issuer: { access_token: 'secret', token_type: 'Bearer' as const } },
      latestIssuer: 'issuer'
    };
    await store.save(record);
    expect(new TextDecoder().decode(await readFile(filePath))).not.toContain('"access_token"');
    await expect(store.load()).resolves.toEqual(record);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('refuses plaintext fallback when system encryption is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-openart-'));
    roots.push(root);
    const store = new DesktopOpenArtCredentialStore(path.join(root, 'credentials.bin'), {
      available: () => false,
      protect: () => new Uint8Array(),
      unprotect: () => ''
    });
    await expect(store.save({ clients: {}, tokens: {} })).rejects.toThrow('unavailable');
  });

  it('removes an unreadable encrypted session and falls back to disconnected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lighttable-openart-'));
    roots.push(root);
    const filePath = path.join(root, 'credentials.bin');
    const protector = {
      available: () => true,
      protect: (value: string) => new TextEncoder().encode(value),
      unprotect: () => { throw new Error('ciphertext cannot be decrypted'); }
    };
    const store = new DesktopOpenArtCredentialStore(filePath, protector);
    await store.save({ clients: {}, tokens: {} });
    await expect(store.load()).resolves.toBeNull();
    await expect(store.load()).resolves.toBeNull();
  });
});
