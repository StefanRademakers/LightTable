import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(
  repositoryRoot,
  'architecture/reference/implementation/THIRD_PARTY_DEPENDENCY_INVENTORY.json'
);

const readJson = (path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'));
const packageLock = readJson('package-lock.json');

const directRuntime = new Set();
const directDevelopment = new Set();
for (const [path, entry] of Object.entries(packageLock.packages)) {
  if (path.includes('node_modules') || !entry.name) continue;
  for (const name of Object.keys(entry.dependencies ?? {})) directRuntime.add(name);
  for (const name of Object.keys(entry.peerDependencies ?? {})) directRuntime.add(name);
  for (const name of Object.keys(entry.devDependencies ?? {})) directDevelopment.add(name);
}

const npmByKey = new Map();
for (const [path, entry] of Object.entries(packageLock.packages)) {
  if (!path.includes('node_modules/') || !entry.version) continue;
  const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const key = `${name}@${entry.version}`;
  const previous = npmByKey.get(key);
  const runtimePath = entry.dev !== true;
  npmByKey.set(key, {
    ecosystem: 'npm',
    name,
    version: entry.version,
    license: entry.license ?? 'UNKNOWN',
    role: directRuntime.has(name)
      ? 'direct-runtime'
      : directDevelopment.has(name)
        ? 'direct-development'
        : runtimePath || previous?.role === 'transitive-runtime'
          ? 'transitive-runtime'
          : 'transitive-development',
    optional: Boolean(entry.optional && (previous?.optional ?? true))
  });
}

const cargoMetadata = JSON.parse(execFileSync(
  'cargo',
  ['metadata', '--format-version', '1', '--locked'],
  { cwd: repositoryRoot, encoding: 'utf8' }
));
const workspaceMembers = new Set(cargoMetadata.workspace_members);
const directCargo = new Set(cargoMetadata.packages
  .filter((entry) => workspaceMembers.has(entry.id))
  .flatMap((entry) => entry.dependencies.map((dependency) => dependency.name)));
const cargo = cargoMetadata.packages
  .filter((entry) => !workspaceMembers.has(entry.id))
  .map((entry) => ({
    ecosystem: 'cargo',
    name: entry.name,
    version: entry.version,
    license: entry.license ?? (entry.license_file ? `SEE LICENSE FILE: ${entry.license_file}` : 'UNKNOWN'),
    role: directCargo.has(entry.name) ? 'direct-runtime' : 'transitive-runtime',
    source: entry.source ?? 'local'
  }));

const byNameVersion = (left, right) => left.name.localeCompare(right.name)
  || left.version.localeCompare(right.version);
const npm = [...npmByKey.values()].sort(byNameVersion);
cargo.sort(byNameVersion);

const inventory = {
  schemaVersion: 1,
  generatedFrom: ['package-lock.json', 'Cargo.lock', 'cargo metadata --locked'],
  policy: {
    licenseValue: 'SPDX expression or upstream package metadata; UNKNOWN must block release review.',
    roleValues: [
      'direct-runtime', 'transitive-runtime', 'direct-development', 'transitive-development'
    ]
  },
  summary: {
    npmPackages: npm.length,
    npmRuntimePackages: npm.filter((entry) => entry.role.endsWith('runtime')).length,
    cargoPackages: cargo.length,
    unknownLicenses: [...npm, ...cargo].filter((entry) => entry.license === 'UNKNOWN').length
  },
  vendored: [{
    name: 'HarfBuzz hb-gpu WGSL prototype',
    revision: 'c31bd6797a0e55c2b176a7be3a181f36814ec6aa',
    license: 'HarfBuzz old-style MIT license',
    noticeLocation: 'packages/text-webgpu/src/hbGpuShader.generated.ts',
    role: 'runtime-conditional'
  }],
  bundledNoticeSets: [
    {
      component: 'wasm-vips codec bundle',
      packageVersion: npm.find((entry) => entry.name === 'wasm-vips')?.version ?? 'UNKNOWN',
      noticeLocation: 'node_modules/wasm-vips/THIRD-PARTY-NOTICES.md',
      releaseRequirement: 'Ship the upstream notice set with distributions that contain vips.wasm.'
    },
    {
      component: 'Electron and Chromium runtime',
      packageVersion: npm.find((entry) => entry.name === 'electron')?.version ?? 'UNKNOWN',
      noticeLocation: 'node_modules/electron/dist/LICENSES.chromium.html',
      releaseRequirement: 'Retain Electron LICENSE and Chromium third-party notices in desktop distributions.'
    }
  ],
  externalAssets: [{
    name: 'onnx-community/depth-anything-v2-small-ONNX',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX',
    loading: 'Downloaded lazily when depth estimation is requested.'
  }],
  npm,
  cargo
};

const output = `${JSON.stringify(inventory, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== output) {
    console.error('Third-party dependency inventory is stale. Run npm run generate:third-party.');
    process.exit(1);
  }
  console.log(`Third-party dependency inventory is current (${npm.length} npm, ${cargo.length} Cargo).`);
} else {
  writeFileSync(outputPath, output);
  console.log(`Wrote ${outputPath} (${npm.length} npm, ${cargo.length} Cargo).`);
}
