import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { listPackage } = require('@electron/asar');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const verificationMode = process.argv[2] ?? '--all';
if (!['--web', '--desktop', '--all'].includes(verificationMode)) {
  throw new Error(`Unknown distribution verification mode: ${verificationMode}`);
}
const configuredDesktopOutput = process.env.LIGHTTABLE_PACKAGE_OUT || 'out';
const desktopArtifactRoot = path.isAbsolute(configuredDesktopOutput)
  ? configuredDesktopOutput
  : path.join(repositoryRoot, 'apps', 'desktop', configuredDesktopOutput);
const webArtifactRoot = path.join(repositoryRoot, 'apps', 'web', 'dist');
const artifactRoots = [
  ...(verificationMode !== '--desktop' ? [webArtifactRoot] : []),
  ...(verificationMode !== '--web' ? [desktopArtifactRoot] : [])
];
const sourceRoots = [
  path.join(repositoryRoot, 'apps', 'web', 'src'),
  path.join(repositoryRoot, 'apps', 'desktop', 'src'),
  path.join(repositoryRoot, 'packages', 'lighttable-app', 'src'),
  path.join(repositoryRoot, 'packages', 'text-core', 'src'),
  path.join(repositoryRoot, 'packages', 'text-rendering', 'src'),
  path.join(repositoryRoot, 'packages', 'text-webgpu', 'src'),
  path.join(repositoryRoot, 'packages', 'vector-core', 'src'),
  path.join(repositoryRoot, 'packages', 'vector-rendering', 'src'),
  path.join(repositoryRoot, 'packages', 'vector-webgpu', 'src')
];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html']);
const failures = [];
const textWorkerPattern = /^textLayout\.worker-[A-Za-z0-9_-]+\.js$/;
const textWasmPattern = /^text_layout_wasm_bg-[A-Za-z0-9_-]+\.wasm$/;
const textCorpusFixturePattern = /(?:Slice06|Anton-Regular|SourceSerif4-Regular)/i;
const textRendererBakeoffFixturePattern = /(?:\.lt-hbgpu$|text-renderer[\\/]+hb-gpu|hb-gpu[\\/]+manifest)/i;

function hasWorkSegment(value) {
  return value.split(/[\\/]+/).some((segment) => segment.toLowerCase() === 'work');
}

async function walk(directory, visitor) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(entryPath, visitor);
    else await visitor(entryPath);
  }
}

for (const sourceRoot of sourceRoots) {
  await walk(sourceRoot, async (filePath) => {
    if (!sourceExtensions.has(path.extname(filePath))) return;
    const source = await readFile(filePath, 'utf8');
    if (/from\s+['"][^'"]*[\\/]work(?:[\\/]|$)/im.test(source)) {
      failures.push(`production source imports the work queue: ${filePath}`);
    }
  });
}

for (const artifactRoot of artifactRoots) {
  const artifactFiles = [];
  let asarCount = 0;
  await walk(artifactRoot, async (filePath) => {
    artifactFiles.push(filePath);
    const relativePath = path.relative(artifactRoot, filePath);
    if (hasWorkSegment(relativePath)) {
      failures.push(`distribution contains work/: ${filePath}`);
    }
    if (textCorpusFixturePattern.test(relativePath)) {
      failures.push(`distribution contains a test-only typography corpus font: ${filePath}`);
    }
    if (textRendererBakeoffFixturePattern.test(relativePath)) {
      failures.push(`distribution contains a test-only text renderer fixture: ${filePath}`);
    }
    if (path.basename(filePath).toLowerCase() !== 'app.asar') return;
    asarCount += 1;
    const packagedPaths = listPackage(filePath);
    for (const packagedPath of packagedPaths) {
      if (hasWorkSegment(packagedPath)) {
        failures.push(`Electron ASAR contains work/: ${filePath}:${packagedPath}`);
      }
      if (textCorpusFixturePattern.test(packagedPath)) {
        failures.push(`Electron ASAR contains a test-only typography corpus font: ${filePath}:${packagedPath}`);
      }
      if (textRendererBakeoffFixturePattern.test(packagedPath)) {
        failures.push(`Electron ASAR contains a test-only text renderer fixture: ${filePath}:${packagedPath}`);
      }
    }
    const packagedNames = packagedPaths.map((packagedPath) => path.basename(packagedPath));
    if (!packagedNames.some((name) => textWorkerPattern.test(name))) {
      failures.push(`Electron ASAR is missing the lazy text worker: ${filePath}`);
    }
    if (!packagedNames.some((name) => textWasmPattern.test(name))) {
      failures.push(`Electron ASAR is missing the text WASM asset: ${filePath}`);
    }
  });
  if (artifactRoot === webArtifactRoot) {
    const artifactNames = artifactFiles.map((filePath) => path.basename(filePath));
    if (!artifactNames.some((name) => textWorkerPattern.test(name))) {
      failures.push(`web distribution is missing the lazy text worker: ${artifactRoot}`);
    }
    if (!artifactNames.some((name) => textWasmPattern.test(name))) {
      failures.push(`web distribution is missing the text WASM asset: ${artifactRoot}`);
    }
  }
  if (artifactRoot === desktopArtifactRoot && asarCount === 0) {
    failures.push(`desktop distribution contains no app.asar: ${desktopArtifactRoot}`);
  }
}

if (failures.length > 0) {
  console.error('LightTable distribution boundary failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('LightTable distribution boundary passed: work/ and text corpus fixtures are not shipped; text WASM assets are present.');
}
