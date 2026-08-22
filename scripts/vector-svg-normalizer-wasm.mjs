import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmBindgenVersion = '0.2.126';
const rustTarget = 'wasm32-unknown-unknown';
const crateRoot = join(repoRoot, 'crates', 'vector-svg-normalizer-wasm');
const targetRoot = join(repoRoot, '.tools', 'vector-svg-normalizer', 'target');
const stagingParent = join(repoRoot, '.tools', 'vector-svg-normalizer');
const bindgenBinary = join(
  repoRoot,
  '.tools',
  'text-wasm',
  'bin',
  process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen'
);
const generatedRoot = join(repoRoot, 'packages', 'vector-svg-normalizer', 'src', 'generated');
const buildManifest = join(generatedRoot, '.lighttable-vector-svg-normalizer-wasm-build.json');
const generatedFiles = [
  join(generatedRoot, 'vector_svg_normalizer_wasm.js'),
  join(generatedRoot, 'vector_svg_normalizer_wasm.d.ts'),
  join(generatedRoot, 'vector_svg_normalizer_wasm_bg.wasm'),
  join(generatedRoot, 'vector_svg_normalizer_wasm_bg.wasm.d.ts')
];

const fail = (message) => { throw new Error(`[LightTable SVG normalizer WASM] ${message}`); };

const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
    env: { ...process.env, CARGO_TARGET_DIR: targetRoot }
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with code ${result.status}.`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
};

const filesUnder = (path) => {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => filesUnder(join(path, entry.name)));
};

const hashFile = (file) => {
  const hash = createHash('sha256');
  hash.update(file.endsWith('.wasm') ? readFileSync(file) : readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
  return hash.digest('hex');
};

const sourceHash = () => {
  const hash = createHash('sha256');
  const roots = [
    join(repoRoot, 'rust-toolchain.toml'),
    fileURLToPath(import.meta.url),
    join(crateRoot, 'Cargo.toml'),
    join(crateRoot, 'Cargo.lock'),
    join(crateRoot, 'src')
  ];
  for (const file of roots.flatMap(filesUnder)) {
    hash.update(relative(repoRoot, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  hash.update(`wasm-bindgen-cli=${wasmBindgenVersion}\0`);
  return hash.digest('hex');
};

const current = (hash) => {
  if (!existsSync(buildManifest) || !generatedFiles.every(existsSync)) return false;
  try {
    const manifest = JSON.parse(readFileSync(buildManifest, 'utf8'));
    return manifest.sourceHash === hash
      && manifest.wasmBindgenVersion === wasmBindgenVersion
      && generatedFiles.every((file) => manifest.outputs?.[file.slice(generatedRoot.length + 1).replaceAll('\\', '/')] === hashFile(file));
  } catch {
    return false;
  }
};

const ensureToolchain = () => {
  if (!existsSync(bindgenBinary)) fail('Run `npm run setup:text-wasm` once to install the pinned wasm-bindgen CLI.');
  const version = run(bindgenBinary, ['--version'], true);
  if (version !== `wasm-bindgen ${wasmBindgenVersion}`) fail(`Expected wasm-bindgen ${wasmBindgenVersion}, received ${version}.`);
  const targets = run('rustup', ['target', 'list', '--installed'], true).split(/\r?\n/);
  if (!targets.includes(rustTarget)) run('rustup', ['target', 'add', rustTarget]);
};

const build = () => {
  ensureToolchain();
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(generatedRoot, { recursive: true });
  run('cargo', [
    'build', '--locked', '--release', '--target', rustTarget,
    '--manifest-path', join(crateRoot, 'Cargo.toml')
  ]);
  const wasmInput = join(targetRoot, rustTarget, 'release', 'lighttable_vector_svg_normalizer_wasm.wasm');
  if (!existsSync(wasmInput)) fail(`Cargo did not produce ${wasmInput}.`);
  const stagingRoot = mkdtempSync(join(stagingParent, 'generated-'));
  try {
    run(bindgenBinary, [
      wasmInput, '--target', 'web', '--out-dir', stagingRoot,
      '--out-name', 'vector_svg_normalizer_wasm', '--typescript'
    ]);
    for (const destination of generatedFiles) {
      const source = join(stagingRoot, destination.slice(generatedRoot.length + 1));
      if (!existsSync(source)) fail(`wasm-bindgen did not produce ${source}.`);
      copyFileSync(source, destination);
    }
    const outputs = Object.fromEntries(generatedFiles.map((file) => [
      file.slice(generatedRoot.length + 1).replaceAll('\\', '/'), hashFile(file)
    ]));
    writeFileSync(buildManifest, `${JSON.stringify({
      schemaVersion: 1,
      sourceHash: sourceHash(),
      usvgVersion: '0.48.1',
      wasmBindgenVersion,
      rustTarget,
      outputs
    }, null, 2)}\n`);
  } finally {
    const resolvedStaging = resolve(stagingRoot);
    const resolvedParent = resolve(stagingParent);
    if (!resolvedStaging.startsWith(`${resolvedParent}${sep}`)) fail(`Refusing to remove unexpected staging path ${resolvedStaging}.`);
    rmSync(resolvedStaging, { recursive: true, force: true });
  }
  console.log('[LightTable SVG normalizer WASM] Generated bindings are current.');
};

const ensure = () => current(sourceHash())
  ? console.log('[LightTable SVG normalizer WASM] Generated bindings are current.')
  : build();

try {
  const action = process.argv[2] ?? 'ensure';
  if (action === 'build') build();
  else if (action === 'ensure') ensure();
  else fail(`Unknown action "${action}". Use build or ensure.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
