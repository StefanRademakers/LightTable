import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, '../model-manifest.json');

export const readModelManifest = async () => JSON.parse(await readFile(manifestPath, 'utf8'));

export const modelPaths = async (directory) => {
  const manifest = await readModelManifest();
  return Object.fromEntries(manifest.files.map((file) => [file.key, path.join(directory, file.filename)]));
};

export const inspectModelInstallation = async (directory, { verifyHashes = false } = {}) => {
  const manifest = await readModelManifest();
  const files = [];
  for (const item of manifest.files) {
    const target = path.join(directory, item.filename);
    let installed = false;
    let valid = false;
    try {
      const details = await stat(target);
      installed = details.isFile() && details.size === item.bytes;
      valid = installed && (!verifyHashes || await sha256(target) === item.sha256);
    } catch { /* Missing files are reported, not exceptional. */ }
    files.push({ ...item, path: target, installed, valid });
  }
  return { manifest, ready: files.every((file) => file.valid), files };
};

export const installModels = async (directory, { fetch: request = globalThis.fetch, onProgress } = {}) => {
  await mkdir(directory, { recursive: true });
  const manifest = await readModelManifest();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const item = manifest.files[index];
    const target = path.join(directory, item.filename);
    const partial = `${target}.partial`;
    const current = await inspectSingle(target, item);
    if (current) {
      onProgress?.({ phase: 'verified', file: item.filename, fileIndex: index, fileCount: manifest.files.length, received: item.bytes, total: item.bytes });
      continue;
    }
    await rm(partial, { force: true });
    const response = await request(item.url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Model download failed for ${item.filename} (${response.status}).`);
    let received = 0;
    const meter = new TransformStream({ transform(chunk, controller) {
      received += chunk.byteLength;
      onProgress?.({ phase: 'downloading', file: item.filename, fileIndex: index, fileCount: manifest.files.length, received, total: item.bytes });
      controller.enqueue(chunk);
    } });
    await pipeline(Readable.fromWeb(response.body.pipeThrough(meter)), createWriteStream(partial));
    const details = await stat(partial);
    if (details.size !== item.bytes) throw new Error(`Downloaded size mismatch for ${item.filename}.`);
    if (await sha256(partial) !== item.sha256) throw new Error(`Downloaded checksum mismatch for ${item.filename}.`);
    await rm(target, { force: true });
    await rename(partial, target);
    onProgress?.({ phase: 'installed', file: item.filename, fileIndex: index, fileCount: manifest.files.length, received: item.bytes, total: item.bytes });
  }
  return inspectModelInstallation(directory, { verifyHashes: true });
};

const inspectSingle = async (target, item) => {
  try {
    await access(target);
    const details = await stat(target);
    return details.size === item.bytes && await sha256(target) === item.sha256;
  } catch { return false; }
};

const sha256 = async (filename) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const input = createReadStream(filename);
  input.once('error', reject);
  input.on('data', (chunk) => hash.update(chunk));
  input.once('end', () => resolve(hash.digest('hex')));
});
