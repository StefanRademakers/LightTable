import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
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
const velloRepository = 'https://github.com/linebender/vello.git';
const velloCommit = '3fabef9315914fc2fa32eed12afac8922785396b';
const wasmBindgenVersion = '0.2.126';
const rustTarget = 'wasm32-unknown-unknown';
const toolRoot = join(repoRoot, '.tools', 'vector-vello');
const velloRoot = join(toolRoot, 'vello-patched');
const targetRoot = join(toolRoot, 'target');
const bindgenBinary = join(
  repoRoot,
  '.tools',
  'text-wasm',
  'bin',
  process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen'
);
const crateRoot = join(repoRoot, 'crates', 'vector-vello-wasm');
const patchFile = join(crateRoot, 'vello-wgpu30-premultiplied.patch');
const generatedRoot = join(repoRoot, 'packages', 'vector-vello', 'src', 'generated');
const buildManifest = join(generatedRoot, '.lighttable-vector-vello-wasm-build.json');
const generatedFiles = [
  join(generatedRoot, 'vector_vello_wasm.js'),
  join(generatedRoot, 'vector_vello_wasm.d.ts'),
  join(generatedRoot, 'vector_vello_wasm_bg.wasm'),
  join(generatedRoot, 'vector_vello_wasm_bg.wasm.d.ts')
];
const hashRoots = [
  join(repoRoot, 'rust-toolchain.toml'),
  join(repoRoot, 'scripts', 'vector-vello-wasm.mjs'),
  crateRoot
];

const fail = (message) => {
  throw new Error(`[LightTable Vello WASM] ${message}`);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true,
    env: { ...process.env, ...(options.env ?? {}) }
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const details = options.capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    fail(`${command} exited with code ${result.status}.${details}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
};

const commandAvailable = (command) => {
  const result = spawnSync(command, ['--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });
  return !result.error && result.status === 0;
};

const filesUnder = (path) => {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => filesUnder(join(path, entry.name)));
};

const sourceHash = () => {
  const hash = createHash('sha256');
  for (const file of hashRoots.flatMap(filesUnder)) {
    if (file === buildManifest || generatedFiles.includes(file)) continue;
    hash.update(relative(repoRoot, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
    hash.update('\0');
  }
  hash.update(`vello=${velloCommit}\0wasm-bindgen-cli=${wasmBindgenVersion}\0`);
  return hash.digest('hex');
};

const outputHash = (file) => {
  const hash = createHash('sha256');
  if (file.endsWith('.js') || file.endsWith('.d.ts')) {
    hash.update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
  } else {
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
};

const generatedOutputIsCurrent = (hash) => {
  if (!generatedFiles.every(existsSync) || !existsSync(buildManifest)) return false;
  try {
    const manifest = JSON.parse(readFileSync(buildManifest, 'utf8'));
    return manifest.sourceHash === hash
      && manifest.velloCommit === velloCommit
      && manifest.wasmBindgenVersion === wasmBindgenVersion
      && manifest.rustTarget === rustTarget
      && generatedFiles.every((file) => {
        const name = file.slice(generatedRoot.length + 1).replaceAll('\\', '/');
        return manifest.outputs?.[name] === outputHash(file);
      });
  } catch {
    return false;
  }
};

const ensureToolchain = () => {
  if (!commandAvailable('rustup')) fail('Rustup is required to regenerate Vello WASM.');
  run('rustc', ['--version']);
  if (!commandAvailable('cargo')) fail('Cargo is unavailable in the pinned Rust toolchain.');
  const installedTargets = run('rustup', ['target', 'list', '--installed'], { capture: true });
  if (!installedTargets.split(/\r?\n/).includes(rustTarget)) {
    run('rustup', ['target', 'add', rustTarget]);
  }
  if (!existsSync(bindgenBinary)) {
    fail('Run `npm run setup:text-wasm` once to install the pinned repo-local wasm-bindgen CLI.');
  }
  const version = run(bindgenBinary, ['--version'], { capture: true });
  if (version !== `wasm-bindgen ${wasmBindgenVersion}`) {
    fail(`Expected wasm-bindgen ${wasmBindgenVersion}, received ${version || 'no version'}.`);
  }
};

const ensurePatchedVello = () => {
  mkdirSync(toolRoot, { recursive: true });
  if (!existsSync(velloRoot)) {
    run('git', ['clone', '--filter=blob:none', '--no-checkout', velloRepository, velloRoot]);
    run('git', ['fetch', '--depth', '1', 'origin', velloCommit], { cwd: velloRoot });
    run('git', ['checkout', '--detach', velloCommit], { cwd: velloRoot });
    run('git', ['apply', '--whitespace=error-all', patchFile], { cwd: velloRoot });
  }
  if (lstatSync(velloRoot).isSymbolicLink()) {
    fail(`Refusing the unexpected symbolic-link checkout ${velloRoot}.`);
  }
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: velloRoot, capture: true });
  if (head !== velloCommit) fail(`Expected Vello ${velloCommit}, found ${head}.`);
  const reverseCheck = spawnSync('git', ['apply', '--reverse', '--check', patchFile], {
    cwd: velloRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });
  if (reverseCheck.status !== 0) {
    fail('The managed Vello checkout does not contain the exact reviewed compatibility patch.');
  }
};

const build = () => {
  ensureToolchain();
  ensurePatchedVello();
  mkdirSync(targetRoot, { recursive: true });
  const cargoLock = join(crateRoot, 'Cargo.lock');
  if (!existsSync(cargoLock)) {
    run('cargo', [
      'generate-lockfile',
      '--manifest-path', join(crateRoot, 'Cargo.toml')
    ]);
  }
  const hash = sourceHash();
  console.log('[LightTable Vello WASM] Building pinned release module...');
  run('cargo', [
    'build',
    '--locked',
    '--release',
    '--target', rustTarget,
    '--manifest-path', join(crateRoot, 'Cargo.toml')
  ], { env: { CARGO_TARGET_DIR: targetRoot } });

  mkdirSync(generatedRoot, { recursive: true });
  const wasmInput = join(
    targetRoot,
    rustTarget,
    'release',
    'lighttable_vector_vello_wasm.wasm'
  );
  if (!existsSync(wasmInput)) fail(`Cargo did not produce ${wasmInput}.`);
  const stagingRoot = mkdtempSync(join(toolRoot, 'generated-'));
  try {
    run(bindgenBinary, [
      wasmInput,
      '--target', 'web',
      '--out-dir', stagingRoot,
      '--out-name', 'vector_vello_wasm',
      '--typescript'
    ]);
    for (const destination of generatedFiles) {
      const source = join(stagingRoot, destination.slice(generatedRoot.length + 1));
      if (!existsSync(source)) fail(`wasm-bindgen did not produce ${source}.`);
      copyFileSync(source, destination);
    }
    const outputs = Object.fromEntries(generatedFiles.map((file) => [
      file.slice(generatedRoot.length + 1).replaceAll('\\', '/'),
      outputHash(file)
    ]));
    writeFileSync(buildManifest, `${JSON.stringify({
      schemaVersion: 1,
      sourceHash: hash,
      velloRepository,
      velloCommit,
      wasmBindgenVersion,
      rustTarget,
      outputs
    }, null, 2)}\n`);
  } finally {
    const resolvedStaging = resolve(stagingRoot);
    const resolvedToolRoot = resolve(toolRoot);
    if (!resolvedStaging.startsWith(`${resolvedToolRoot}${sep}`)) {
      fail(`Refusing to remove unexpected staging path ${resolvedStaging}.`);
    }
    if (lstatSync(resolvedStaging).isSymbolicLink()) {
      fail(`Refusing to remove symbolic-link staging path ${resolvedStaging}.`);
    }
    rmSync(resolvedStaging, { recursive: true, force: true });
  }
  console.log('[LightTable Vello WASM] Generated bindings are current.');
};

const ensure = () => {
  const hash = sourceHash();
  if (generatedOutputIsCurrent(hash)) {
    console.log('[LightTable Vello WASM] Generated bindings are current.');
    return;
  }
  build();
};

const action = process.argv[2] ?? 'ensure';
try {
  if (action === 'build') build();
  else if (action === 'ensure') ensure();
  else fail(`Unknown action "${action}". Use build or ensure.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
