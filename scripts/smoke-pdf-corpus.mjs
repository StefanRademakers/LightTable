import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const appRequire = createRequire(path.join(
  workspaceRoot,
  'packages',
  'lighttable-app',
  'package.json'
));
const pdfJsModulePath = appRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const pdfJsAssetDirectory = path.resolve(path.dirname(pdfJsModulePath), '..', '..');
const pdfjs = await import(pathToFileURL(pdfJsModulePath).href);

const argument = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);
const asPositiveInteger = (name, fallback) => {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return value;
};

const corpusDirectory = path.resolve(argument('dir', ''));
const pdfJsAssetUrl = (directory) => `${path.join(pdfJsAssetDirectory, directory)}/`;
const outputFile = path.resolve(argument(
  'output',
  path.join('tmp', 'pdf-corpus-smoke.json')
));
const matchSource = argument('match', '');
const match = matchSource ? new RegExp(matchSource, 'i') : null;
const requestedFiles = argument('files', '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const limit = Number.parseInt(argument('limit', '0'), 10);
const sample = Number.parseInt(argument('sample', '0'), 10);
const concurrency = asPositiveInteger('concurrency', 2);
const timeoutMs = asPositiveInteger('timeout-ms', 30_000);
const maxBytes = asPositiveInteger('max-bytes', 64 * 1024 * 1024);
const quiet = hasFlag('quiet');
const internalBatch = hasFlag('internal-batch');
const batchSize = asPositiveInteger('batch-size', 50);

if (!argument('dir', '')) {
  throw new Error('Pass the PDF corpus directory with --dir <path>.');
}
if (!Number.isSafeInteger(limit) || limit < 0) {
  throw new Error('--limit must be zero (all files) or a positive integer.');
}
if (!Number.isSafeInteger(sample) || sample < 0) {
  throw new Error('--sample must be zero or a positive integer.');
}
if (limit > 0 && sample > 0) {
  throw new Error('Use either --limit or --sample, not both.');
}

const pdfFiles = (await readdir(corpusDirectory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
  .map(entry => entry.name)
  .filter(name => requestedFiles.length === 0 || requestedFiles.includes(name))
  .filter(name => !match || match.test(name))
  .sort((left, right) => left.localeCompare(right));
const selectedFiles = sample > 0 && sample < pdfFiles.length
  ? Array.from(
      { length: sample },
      (_, index) => pdfFiles[Math.floor(index * pdfFiles.length / sample)]
    )
  : limit > 0 ? pdfFiles.slice(0, limit) : pdfFiles;

if (!internalBatch && selectedFiles.length > batchSize) {
  const run = promisify(execFile);
  const batchResults = [];
  await mkdir(path.dirname(outputFile), { recursive: true });
  let reportSequence = 0;
  const runBatch = async (names) => {
    reportSequence += 1;
    const batchOutput = `${outputFile}.batch-${String(reportSequence).padStart(3, '0')}.json`;
    const args = [
      import.meta.filename,
      '--dir', corpusDirectory,
      '--files', names.join(','),
      '--concurrency', String(concurrency),
      '--timeout-ms', String(timeoutMs),
      '--max-bytes', String(maxBytes),
      '--output', batchOutput,
      '--internal-batch'
    ];
    if (quiet) args.push('--quiet');
    try {
      await run(process.execPath, args, { maxBuffer: 16 * 1024 * 1024 });
      const batch = JSON.parse(await readFile(batchOutput, 'utf8'));
      batchResults.push(...batch.results);
    } catch (error) {
      if (names.length > 1) {
        const middle = Math.ceil(names.length / 2);
        await runBatch(names.slice(0, middle));
        await runBatch(names.slice(middle));
        return;
      }
      const workerOutput = String(error?.stderr || error?.message || error).trim();
      const fatalLine = workerOutput.split(/\r?\n/)
        .find(line => /fatal error:|heap out of memory|timed out/i.test(line));
      batchResults.push({
        file: names[0],
        status: 'failed',
        errorName: 'CorpusWorkerError',
        error: fatalLine?.trim() || workerOutput.split(/\r?\n/).filter(Boolean).at(-1) || 'Worker failed.'
      });
    }
  };
  for (let offset = 0; offset < selectedFiles.length; offset += batchSize) {
    const names = selectedFiles.slice(offset, offset + batchSize);
    const batchNumber = Math.floor(offset / batchSize) + 1;
    await runBatch(names);
    if (!quiet) console.info(`Completed PDF corpus batch ${batchNumber}.`);
  }
  const summary = {
    corpusDirectory,
    selected: selectedFiles.length,
    passed: batchResults.filter(result => result.status === 'passed').length,
    failed: batchResults.filter(result => result.status === 'failed').length,
    passwordProtected: batchResults.filter(result => result.status === 'password').length,
    skipped: batchResults.filter(result => result.status === 'skipped').length,
    generatedAt: new Date().toISOString(),
    limits: { concurrency, timeoutMs, maxBytes, batchSize },
    results: batchResults
  };
  await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.info(
    `PDF corpus smoke: ${summary.passed} passed, ${summary.failed} failed, `
    + `${summary.passwordProtected} password protected, ${summary.skipped} skipped. `
    + `Report: ${outputFile}`
  );
  process.exit(hasFlag('fail-on-error') && summary.failed > 0 ? 1 : 0);
}

const withTimeout = async (promise, milliseconds, onTimeout) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`Timed out after ${milliseconds} ms.`));
        }, milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const destroyLoadingTask = async (loadingTask) => {
  if (!loadingTask) return;
  await Promise.race([
    loadingTask.destroy().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 1_000))
  ]);
};

const analyzePdf = async (name) => {
  const filePath = path.join(corpusDirectory, name);
  const fileStat = await stat(filePath);
  if (fileStat.size > maxBytes) {
    return {
      file: name,
      status: 'skipped',
      reason: `File exceeds ${maxBytes} bytes.`,
      byteLength: fileStat.size
    };
  }

  const startedAt = performance.now();
  let loadingTask;
  try {
    const bytes = new Uint8Array(await readFile(filePath));
    loadingTask = pdfjs.getDocument({
      data: bytes,
      cMapPacked: true,
      cMapUrl: pdfJsAssetUrl('cmaps'),
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false,
      standardFontDataUrl: pdfJsAssetUrl('standard_fonts'),
      stopAtErrors: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
      wasmUrl: pdfJsAssetUrl('wasm')
    });
    const document = await withTimeout(
      loadingTask.promise,
      timeoutMs,
      () => { void loadingTask?.destroy().catch(() => {}); }
    );
    const page = await withTimeout(
      document.getPage(1),
      timeoutMs,
      () => { void loadingTask?.destroy().catch(() => {}); }
    );
    const [operators, textContent] = await withTimeout(
      Promise.all([page.getOperatorList(), page.getTextContent()]),
      timeoutMs,
      () => { void loadingTask?.destroy().catch(() => {}); }
    );

    const count = (operation) => operators.fnArray.reduce(
      (total, value) => total + Number(value === operation),
      0
    );
    return {
      file: name,
      status: 'passed',
      byteLength: fileStat.size,
      pages: document.numPages,
      firstPage: {
        width: page.view[2] - page.view[0],
        height: page.view[3] - page.view[1],
        rotation: page.rotate,
        operators: operators.fnArray.length,
        textItems: textContent.items.length,
        textCharacters: textContent.items.reduce(
          (total, item) => total + ('str' in item ? item.str.length : 0),
          0
        ),
        paths: count(pdfjs.OPS.constructPath),
        images: count(pdfjs.OPS.paintImageXObject)
          + count(pdfjs.OPS.paintInlineImageXObject)
          + count(pdfjs.OPS.paintImageMaskXObject),
        forms: count(pdfjs.OPS.paintFormXObjectBegin),
        clips: count(pdfjs.OPS.clip) + count(pdfjs.OPS.eoClip),
        shadingFills: count(pdfjs.OPS.shadingFill),
        graphicsStates: count(pdfjs.OPS.setGState)
      },
      milliseconds: Math.round((performance.now() - startedAt) * 10) / 10
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      return {
        file: name,
        status: 'password',
        byteLength: fileStat.size,
        error: error.message,
        milliseconds: Math.round((performance.now() - startedAt) * 10) / 10
      };
    }
    return {
      file: name,
      status: 'failed',
      byteLength: fileStat.size,
      errorName: error instanceof Error ? error.name : 'Error',
      error: error instanceof Error ? error.message : String(error),
      milliseconds: Math.round((performance.now() - startedAt) * 10) / 10
    };
  } finally {
    await destroyLoadingTask(loadingTask);
  }
};

const results = new Array(selectedFiles.length);
let nextIndex = 0;
const workers = Array.from(
  { length: Math.min(concurrency, selectedFiles.length) },
  async () => {
    while (nextIndex < selectedFiles.length) {
      const index = nextIndex;
      nextIndex += 1;
      const result = await analyzePdf(selectedFiles[index]);
      results[index] = result;
      const timing = 'milliseconds' in result ? ` (${result.milliseconds} ms)` : '';
      if (!quiet) console.info(`${result.status.padEnd(7)} ${result.file}${timing}`);
    }
  }
);
await Promise.all(workers);

const summary = {
  corpusDirectory,
  selected: selectedFiles.length,
  passed: results.filter(result => result.status === 'passed').length,
  failed: results.filter(result => result.status === 'failed').length,
  passwordProtected: results.filter(result => result.status === 'password').length,
  skipped: results.filter(result => result.status === 'skipped').length,
  generatedAt: new Date().toISOString(),
  limits: { concurrency, timeoutMs, maxBytes },
  results
};
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`);

console.info(
  `PDF corpus smoke: ${summary.passed} passed, ${summary.failed} failed, `
  + `${summary.passwordProtected} password protected, ${summary.skipped} skipped. `
  + `Report: ${outputFile}`
);
if (hasFlag('fail-on-error') && summary.failed > 0) process.exitCode = 1;
