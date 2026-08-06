import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  atomicWriteFile,
  AtomicWriteError,
  type AtomicWritePhase
} from './atomicFileWriter';

const directories: string[] = [];
const png = (payload: string) => Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10,
  ...new TextEncoder().encode(payload)
]);

const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lighttable-atomic-save-'));
  directories.push(directory);
  const targetPath = path.join(directory, 'document-lighttable.png');
  const previous = png('previous-valid-document');
  await writeFile(targetPath, previous);
  return { targetPath, previous };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe('atomicWriteFile', () => {
  it('flushes, validates and replaces a prior document', async () => {
    const { targetPath } = await fixture();
    const next = png('next-valid-document');
    const phases: AtomicWritePhase[] = [];
    const result = await atomicWriteFile({
      targetPath,
      bytes: next,
      injectFault: (phase) => { phases.push(phase); }
    });
    expect(result.durability).toBe('atomic-replace');
    expect(new Uint8Array(await readFile(targetPath))).toEqual(next);
    expect(phases).toEqual(['prepare', 'write', 'flush', 'validate', 'replace']);
  });

  it.each<AtomicWritePhase>(['prepare', 'write', 'flush', 'validate', 'replace'])(
    'preserves the prior byte-valid file after a %s failure',
    async (failedPhase) => {
      const { targetPath, previous } = await fixture();
      await expect(atomicWriteFile({
        targetPath,
        bytes: png('never-published'),
        injectFault: (phase) => {
          if (phase === failedPhase) throw new Error(`Injected ${phase} failure`);
        }
      })).rejects.toMatchObject({ phase: failedPhase });
      expect(new Uint8Array(await readFile(targetPath))).toEqual(previous);
    }
  );

  it('rejects an artifact that fails container validation before replacement', async () => {
    const { targetPath, previous } = await fixture();
    await expect(atomicWriteFile({
      targetPath,
      bytes: png('invalid-container'),
      validate: async () => { throw new Error('Invalid container'); }
    })).rejects.toBeInstanceOf(AtomicWriteError);
    expect(new Uint8Array(await readFile(targetPath))).toEqual(previous);
  });

  it('uses the safe backup fallback when direct replacement is unavailable', async () => {
    const { targetPath } = await fixture();
    const next = png('safe-fallback-document');
    let calls = 0;
    const result = await atomicWriteFile({
      targetPath,
      bytes: next,
      renameFile: async (source, target) => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('replace unsupported'), { code: 'EPERM' });
        }
        await rename(source, target);
      }
    });
    expect(result.durability).toBe('safe-replace');
    expect(new Uint8Array(await readFile(targetPath))).toEqual(next);
  });

  it('restores the previous file when fallback publication fails', async () => {
    const { targetPath, previous } = await fixture();
    let calls = 0;
    await expect(atomicWriteFile({
      targetPath,
      bytes: png('failed-fallback-document'),
      renameFile: async (source, target) => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('replace unsupported'), { code: 'EPERM' });
        }
        if (calls === 3) {
          throw Object.assign(new Error('publication failed'), { code: 'EIO' });
        }
        await rename(source, target);
      }
    })).rejects.toMatchObject({ phase: 'replace' });
    expect(new Uint8Array(await readFile(targetPath))).toEqual(previous);
  });
});
