import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopAgentAccessCredentialStore } from './agentAccessCredentialStore';

const roots: string[] = [];
const protector = {
  available: () => true,
  protect: (value: string) => new TextEncoder().encode([...value].reverse().join('')),
  unprotect: (value: Uint8Array) => [...new TextDecoder().decode(value)].reverse().join('')
};

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('DesktopAgentAccessCredentialStore', () => {
  it('persists and rotates protected high-entropy credentials', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lighttable-agent-'));
    roots.push(root);
    const file = path.join(root, 'credentials.bin');
    const store = new DesktopAgentAccessCredentialStore(file, protector);
    const first = await store.loadOrCreate();
    expect(first.token.length).toBeGreaterThanOrEqual(40);
    expect(new TextDecoder().decode(await readFile(file))).not.toContain(first.token.slice(0, 12));
    expect(await store.loadOrCreate()).toEqual(first);
    const rotated = await store.rotate();
    expect(rotated.deviceId).toBe(first.deviceId);
    expect(rotated.token).not.toBe(first.token);
  });

  it('fails closed when OS credential protection is unavailable', async () => {
    const store = new DesktopAgentAccessCredentialStore('unused', { ...protector, available: () => false });
    await expect(store.loadOrCreate()).rejects.toThrow('OS-protected');
  });
});
