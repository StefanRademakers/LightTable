import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(
  repositoryRoot,
  'architecture/reference/implementation/THIRD_PARTY_DEPENDENCY_INVENTORY.json'
);
const productDisclosurePath = resolve(
  repositoryRoot,
  'packages/lighttable-app/src/lighttable/application/compliance/thirdPartyDisclosures.generated.ts'
);

// This is deliberately a product-facing selection rather than a dependency dump.
// Versions and licenses are still projected from the lockfiles below, so the UI
// cannot silently drift from the software that is actually shipped.
const productDisclosureDefinitions = [
  { category: 'Application', name: 'React', packages: ['react'], description: 'Application interface runtime.' },
  { category: 'Application', name: 'Dockview', packages: ['dockview-react'], description: 'Dockable panel and workspace layout.' },
  { category: 'Documents and imaging', name: 'ag-psd', packages: ['ag-psd'], description: 'Photoshop document reading and writing.' },
  { category: 'Documents and imaging', name: 'PDF.js', packages: ['pdfjs-dist'], description: 'PDF document loading and rendering.' },
  { category: 'Documents and imaging', name: 'pdf-lib', packages: ['pdf-lib'], description: 'PDF document creation and editing.' },
  { category: 'Text and fonts', name: 'HarfBuzz.js', packages: ['harfbuzzjs'], description: 'OpenType text shaping.' },
  { category: 'Text and fonts', name: 'Parley', packages: ['parley'], description: 'Text layout engine.' },
  { category: 'Text and fonts', name: 'Fontique', packages: ['fontique'], description: 'Font discovery and fallback.' },
  { category: 'Text and fonts', name: 'Skrifa', packages: ['skrifa'], description: 'Font outline and metrics processing.' },
  { category: 'Text and fonts', name: 'Zeno', packages: ['zeno'], description: 'Glyph outline rasterization.' },
  { category: 'Bundled fonts', name: 'Inter', packages: ['@fontsource/inter'], description: 'Bundled sans-serif typeface.' },
  { category: 'Bundled fonts', name: 'Noto Sans', packages: ['@fontsource/noto-sans'], description: 'Bundled multilingual sans-serif typeface.' },
  { category: 'Bundled fonts', name: 'Source Serif 4', packages: ['@fontsource/source-serif-4'], description: 'Bundled serif typeface.' },
  { category: 'Bundled fonts', name: 'JetBrains Mono', packages: ['@fontsource/jetbrains-mono'], description: 'Bundled monospaced typeface.' },
  { category: 'AI and automation', name: 'Transformers.js', packages: ['@huggingface/transformers'], description: 'Local machine-learning model runtime.' },
  { category: 'AI and automation', name: 'MediaPipe Tasks Vision', packages: ['@mediapipe/tasks-vision'], description: 'On-device face landmark detection runtime.' }
];

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
  }, {
    name: 'Compact ICC Profiles sRGB-v2-micro',
    revision: '0a8a33aea66a6f154a5642ebe168ef287e73265d9f7b51c42a45e6eedbacda7a',
    license: 'CC0-1.0',
    noticeLocation: 'packages/lighttable-app/src/lighttable/editor/color/srgbIccProfile.ts',
    source: 'https://github.com/saucecontrol/Compact-ICC-Profiles',
    role: 'runtime-embedded-asset'
  }],
  bundledNoticeSets: [
    {
      component: 'wasm-vips codec bundle',
      packageVersion: npm.find((entry) => entry.name === 'wasm-vips')?.version ?? 'UNKNOWN',
      licenseSummary: 'LGPL-3.0 and bundled licenses',
      noticeLocation: 'node_modules/wasm-vips/THIRD-PARTY-NOTICES.md',
      releaseRequirement: 'Ship the upstream notice set with distributions that contain vips.wasm.'
    },
    {
      component: 'Electron and Chromium runtime',
      packageVersion: npm.find((entry) => entry.name === 'electron')?.version ?? 'UNKNOWN',
      licenseSummary: 'MIT and bundled licenses',
      noticeLocation: 'node_modules/electron/dist/LICENSES.chromium.html',
      releaseRequirement: 'Retain Electron LICENSE and Chromium third-party notices in desktop distributions.'
    }
  ],
  externalAssets: [{
    name: 'onnx-community/depth-anything-v2-small-ONNX',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX',
    loading: 'Downloaded lazily when depth estimation is requested.'
  }, {
    name: 'Xenova/slimsam-77-uniform',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Xenova/slimsam-77-uniform',
    loading: 'Downloaded lazily when Object Selection is first requested.'
  }, {
    name: 'BEN2 Base ONNX FP16',
    license: 'MIT',
    source: 'https://huggingface.co/onnx-community/BEN2-ONNX/tree/c552aa82688edce09f0ac9d2e31ad53d9d629010',
    loading: 'Downloaded lazily when Remove Background is first requested; revision and FP16 artifact digest are pinned.',
    sha256: 'dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1'
  }, {
    name: 'MediaPipe Face Landmarker model',
    license: 'Apache-2.0',
    source: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
    loading: 'Bundled locally and loaded lazily when face detection is requested.',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
  }, {
    name: 'MediaPipe BlazeFace short-range detector model',
    license: 'Apache-2.0',
    source: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    loading: 'Bundled locally and loaded only during explicit Face Warp detection as an independent quality observation.',
    sha256: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f'
  }],
  npm,
  cargo
};

const dependencyByName = new Map([...npm, ...cargo].map((entry) => [entry.name, entry]));
const productDisclosures = productDisclosureDefinitions.map((definition) => {
  const dependencies = definition.packages.map((name) => {
    const dependency = dependencyByName.get(name);
    if (!dependency) throw new Error(`Product disclosure dependency is missing: ${name}`);
    if (!dependency.role.endsWith('runtime')) {
      throw new Error(`Product disclosure dependency is not a runtime dependency: ${name}`);
    }
    return dependency;
  });
  return {
    category: definition.category,
    name: definition.name,
    version: [...new Set(dependencies.map(({ version }) => version))].join(', '),
    license: [...new Set(dependencies.map(({ license }) => license))].join(' / '),
    description: definition.description,
    platform: 'all'
  };
});
productDisclosures.push(
  ...inventory.bundledNoticeSets.map((entry) => ({
    category: entry.component.startsWith('wasm-vips') ? 'Documents and imaging' : 'Application',
    name: entry.component,
    version: entry.packageVersion,
    license: entry.licenseSummary,
    description: entry.component.startsWith('wasm-vips')
      ? 'Native image codecs included in the WebAssembly image runtime.'
      : 'Desktop application and browser runtime.',
    platform: entry.component.startsWith('wasm-vips') ? 'all' : 'desktop'
  })),
  ...inventory.vendored.map((entry) => ({
    category: entry.name.includes('ICC') ? 'Documents and imaging' : 'Text and fonts',
    name: entry.name,
    version: entry.revision.slice(0, 12),
    license: entry.license,
    description: entry.role === 'runtime-embedded-asset'
      ? 'Embedded product asset.'
      : 'Runtime component used by the GPU text pipeline.',
    platform: 'all'
  })),
  ...inventory.externalAssets.map((entry) => ({
    category: 'AI and automation',
    name: entry.name,
    version: 'Loaded on demand',
    license: entry.license,
    description: entry.loading,
    platform: 'all'
  }))
);

const disclosureOutput = `// Generated by scripts/generate-third-party-inventory.mjs. Do not edit.\n`
  + `export const LIGHTTABLE_PRODUCT_DISCLOSURES = ${JSON.stringify(productDisclosures, null, 2)} as const;\n`;

const output = `${JSON.stringify(inventory, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  const currentDisclosures = readFileSync(productDisclosurePath, 'utf8');
  if (current !== output || currentDisclosures !== disclosureOutput) {
    console.error('Third-party dependency inventory is stale. Run npm run generate:third-party.');
    process.exit(1);
  }
  console.log(`Third-party dependency inventory is current (${npm.length} npm, ${cargo.length} Cargo).`);
} else {
  writeFileSync(outputPath, output);
  mkdirSync(dirname(productDisclosurePath), { recursive: true });
  writeFileSync(productDisclosurePath, disclosureOutput);
  console.log(`Wrote ${outputPath} (${npm.length} npm, ${cargo.length} Cargo).`);
}
