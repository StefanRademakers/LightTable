import { readFile, writeFile } from 'node:fs/promises';
import { sign } from 'node:crypto';
import path from 'node:path';

const input = process.argv[2];
const output = process.argv[3];
const keyPath = process.env.LIGHTTABLE_UPDATE_PRIVATE_KEY_FILE;
if (!input || !output) throw new Error('Usage: sign-update-manifest <unsigned.json> <signed.json>');
if (!keyPath) {
  throw new Error('LIGHTTABLE_UPDATE_PRIVATE_KEY_FILE is required; private keys are never stored in the repository.');
}
const value = JSON.parse(await readFile(path.resolve(input), 'utf8'));
if ('signature' in value) delete value.signature;
const canonical = JSON.stringify({
  schemaVersion: value.schemaVersion,
  product: value.product,
  version: value.version,
  channel: value.channel,
  publishedAt: value.publishedAt,
  releaseNotes: value.releaseNotes,
  minimumDocumentManifestVersion: value.minimumDocumentManifestVersion,
  maximumRecoveryVersion: value.maximumRecoveryVersion,
  artifact: {
    url: value.artifact?.url,
    sha256: value.artifact?.sha256,
    byteLength: value.artifact?.byteLength
  }
});
const signature = sign(
  null,
  Buffer.from(canonical),
  await readFile(path.resolve(keyPath), 'utf8')
).toString('base64');
await writeFile(path.resolve(output), `${JSON.stringify({ ...value, signature }, null, 2)}\n`, 'utf8');
console.log(`Signed update manifest written to ${path.resolve(output)}.`);
