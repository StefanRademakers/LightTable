import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const inventoryPath = path.join(root, 'architecture', 'reference', 'implementation', 'THIRD_PARTY_DEPENDENCY_INVENTORY.json');
const outputDirectory = path.join(root, 'architecture', 'reference', 'implementation', 'release');
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const runtime = [...inventory.npm, ...inventory.cargo]
  .filter(({ role }) => role.includes('runtime'))
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:6dd0d156-59eb-50e8-9d33-lighttable-alpha',
  version: 1,
  metadata: { component: { type: 'application', name: 'LightTable', version: '0.1.0-alpha.1' } },
  components: runtime.map((entry) => ({
    type: 'library',
    group: entry.ecosystem,
    name: entry.name,
    version: entry.version,
    licenses: [{ license: { id: entry.license } }],
    scope: entry.role.includes('development') ? 'optional' : 'required'
  }))
};
const notices = [
  '# LightTable third-party notices',
  '',
  'Generated from package-lock.json, Cargo.lock and the checked dependency inventory.',
  '',
  ...runtime.map((entry) => `- ${entry.name} ${entry.version} — ${entry.license}`),
  '',
  'Bundled notice sets:',
  ...inventory.bundledNoticeSets.map((entry) => `- ${entry.component}: ${entry.noticeLocation}`),
  ''
].join('\n');

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, 'LIGHTTABLE_SBOM.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8'),
  writeFile(path.join(outputDirectory, 'THIRD_PARTY_NOTICES.md'), notices, 'utf8')
]);
console.log(`Release SBOM/notices generated for ${runtime.length} runtime components.`);
