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
const toolRoot = join(repoRoot, '.tools', 'text-wasm');
const bindgenBinary = join(
  toolRoot,
  'bin',
  process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen'
);
const generatedRoot = join(
  repoRoot,
  'packages',
  'lighttable-app',
  'src',
  'lighttable',
  'text',
  'wasm',
  'generated'
);
const buildManifest = join(generatedRoot, '.lighttable-text-wasm-build.json');
const generatedFiles = [
  join(generatedRoot, 'text_layout_wasm.js'),
  join(generatedRoot, 'text_layout_wasm.d.ts'),
  join(generatedRoot, 'text_layout_wasm_bg.wasm'),
  join(generatedRoot, 'text_layout_wasm_bg.wasm.d.ts')
];
const hashRoots = [
  join(repoRoot, 'Cargo.toml'),
  join(repoRoot, 'Cargo.lock'),
  join(repoRoot, 'rust-toolchain.toml'),
  join(repoRoot, 'scripts', 'text-wasm.mjs'),
  join(repoRoot, 'crates', 'text-layout-wasm')
];

const fail = (message) => {
  throw new Error(`[LightTable text WASM] ${message}`);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true
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
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => filesUnder(join(path, entry.name)));
};

const sourceHash = () => {
  const hash = createHash('sha256');
  for (const file of hashRoots.flatMap(filesUnder)) {
    hash.update(relative(repoRoot, file).replaceAll('\\', '/'));
    hash.update('\0');
    // Git may materialize CRLF on Windows. Hash normalized source text so a
    // clean checkout does not rebuild committed WASM solely for line endings.
    hash.update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
    hash.update('\0');
  }
  hash.update(`wasm-bindgen-cli=${wasmBindgenVersion}\0`);
  return hash.digest('hex');
};

const generatedOutputHash = (file) => {
  const hash = createHash('sha256');
  if (file.endsWith('.js') || file.endsWith('.d.ts')) {
    // Git can materialize generated text with CRLF on Windows while the
    // committed manifest records the canonical LF output from wasm-bindgen.
    // Do not rebuild the binary solely because of that checkout conversion.
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
      && manifest.wasmBindgenVersion === wasmBindgenVersion
      && manifest.rustTarget === rustTarget
      && generatedFiles.every((file) => {
        const name = file.slice(generatedRoot.length + 1).replaceAll('\\', '/');
        const outputHash = generatedOutputHash(file);
        return manifest.outputs?.[name] === outputHash;
      });
  } catch {
    return false;
  }
};

const ensureRustPrerequisites = () => {
  if (!commandAvailable('rustup')) {
    fail(
      'Rustup is required for source builds. Install Rust from '
      + 'https://rustup.rs/ and run `npm run setup:text-wasm` again.'
    );
  }

  // The checked-in rust-toolchain.toml pins the exact compiler. Invoking
  // rustc lets rustup provision that toolchain when it is absent.
  run('rustc', ['--version']);
  if (!commandAvailable('cargo')) {
    console.log('[LightTable text WASM] Installing Cargo for the pinned Rust toolchain...');
    run('rustup', ['component', 'add', 'cargo']);
  }
  if (!commandAvailable('cargo')) {
    fail('Cargo is unavailable after Rustup setup. Repair the pinned Rust toolchain and retry.');
  }
  const installedTargets = run('rustup', ['target', 'list', '--installed'], { capture: true });
  if (!installedTargets.split(/\r?\n/).includes(rustTarget)) {
    console.log(`[LightTable text WASM] Installing Rust target ${rustTarget}...`);
    run('rustup', ['target', 'add', rustTarget]);
  }
};

const ensureBindgenCli = () => {
  let installedVersion = '';
  if (existsSync(bindgenBinary)) {
    installedVersion = run(bindgenBinary, ['--version'], { capture: true });
  }
  if (installedVersion === `wasm-bindgen ${wasmBindgenVersion}`) return;

  console.log(
    `[LightTable text WASM] Installing repo-local wasm-bindgen-cli ${wasmBindgenVersion}...`
  );
  mkdirSync(toolRoot, { recursive: true });
  run('cargo', [
    'install',
    'wasm-bindgen-cli',
    '--version', wasmBindgenVersion,
    '--locked',
    '--root', toolRoot,
    '--force'
  ]);
  const verifiedVersion = run(bindgenBinary, ['--version'], { capture: true });
  if (verifiedVersion !== `wasm-bindgen ${wasmBindgenVersion}`) {
    fail(`Expected wasm-bindgen ${wasmBindgenVersion}, received ${verifiedVersion || 'no version'}.`);
  }
};

const setup = () => {
  ensureRustPrerequisites();
  ensureBindgenCli();
  console.log('[LightTable text WASM] Toolchain is ready.');
};

const build = (hash = sourceHash()) => {
  setup();
  console.log('[LightTable text WASM] Building release WebAssembly module...');
  run('cargo', [
    'build',
    '--locked',
    '--release',
    '--target', rustTarget,
    '--package', 'lighttable-text-layout-wasm'
  ]);

  mkdirSync(generatedRoot, { recursive: true });
  mkdirSync(toolRoot, { recursive: true });
  const wasmInput = join(
    repoRoot,
    'target',
    rustTarget,
    'release',
    'lighttable_text_layout_wasm.wasm'
  );
  if (!existsSync(wasmInput)) fail(`Cargo did not produce ${relative(repoRoot, wasmInput)}.`);
  const stagingRoot = mkdtempSync(join(toolRoot, 'generated-'));
  try {
    run(bindgenBinary, [
      wasmInput,
      '--target', 'web',
      '--out-dir', stagingRoot,
      '--out-name', 'text_layout_wasm',
      '--typescript'
    ]);
    for (const destination of generatedFiles) {
      const source = join(stagingRoot, destination.slice(generatedRoot.length + 1));
      if (!existsSync(source)) fail(`wasm-bindgen did not produce ${source}.`);
    }
    // Publish only after bindgen produced the complete set. The manifest is
    // written last, so interrupted copies are rejected by the output hashes.
    for (const destination of generatedFiles) {
      const source = join(stagingRoot, destination.slice(generatedRoot.length + 1));
      copyFileSync(source, destination);
    }
    const outputs = Object.fromEntries(generatedFiles.map((file) => [
      file.slice(generatedRoot.length + 1).replaceAll('\\', '/'),
      generatedOutputHash(file)
    ]));
    writeFileSync(buildManifest, `${JSON.stringify({
      schemaVersion: 1,
      sourceHash: hash,
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
    rmSync(resolvedStaging, { recursive: true, force: true });
  }
  console.log('[LightTable text WASM] Generated bindings are current.');
};

const ensure = () => {
  const hash = sourceHash();
  if (generatedOutputIsCurrent(hash)) {
    console.log('[LightTable text WASM] Generated bindings are current.');
    return;
  }
  build(hash);
};

const action = process.argv[2] ?? 'ensure';
try {
  if (action === 'setup') setup();
  else if (action === 'build') build();
  else if (action === 'ensure') ensure();
  else fail(`Unknown action "${action}". Use setup, build or ensure.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
