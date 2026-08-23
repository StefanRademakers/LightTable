import { spawn } from 'node:child_process';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const electron = path.resolve(root, '../../../../../node_modules/electron/dist/electron.exe');
const repetitions = Number.parseInt(process.argv[2] ?? '5', 10);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) {
  throw new RangeError('Repetitions must be an integer from 1 through 20.');
}

const waitForReport = async (reportPath, startedAt) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(reportPath);
      if (info.mtimeMs >= startedAt) return JSON.parse(await readFile(reportPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${path.basename(reportPath)}.`);
};

const reports = [];
for (let index = 0; index < repetitions; index += 1) {
  const reportName = `bakeoff-report-${index}.json`;
  const reportPath = path.join(root, reportName);
  await rm(reportPath, { force: true });
  const startedAt = Date.now();
  const childEnvironment = { ...process.env, LIGHTTABLE_BAKEOFF_REPORT: reportName };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['bakeoff-main.cjs'], {
    cwd: root,
    env: childEnvironment,
    stdio: 'ignore',
    windowsHide: true
  });
  const report = await waitForReport(reportPath, startedAt);
  reports.push(report);
  if (child.exitCode === null) child.unref();
  if (report.code !== 0) throw new Error(`Bake-off repetition ${index} failed.`);
  await new Promise(resolve => setTimeout(resolve, 100));
}

const values = (selector) => reports.map(selector);
const processWorkingSet = (report, phase, type) => report.phaseMetrics[phase]
  .find(metric => metric.type === type)?.workingSetKb ?? 0;
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples,
    min: sorted[0],
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
    max: sorted[sorted.length - 1]
  };
};
const assetDirectory = path.join(root, 'bakeoff-dist/assets');
const wasmFile = (await readdir(assetDirectory)).find(file => file.endsWith('.wasm'));
if (!wasmFile) throw new Error('Built Vello WASM asset is missing.');
const wasmBytes = await readFile(path.join(assetDirectory, wasmFile));

const evidence = {
  generatedAt: new Date().toISOString(),
  repetitions,
  scene: reports[0].scene,
  correctness: reports.map(report => ({ pixels: report.pixels, parityCases: report.parityCases })),
  current: {
    coldCallMs: summarize(values(report => report.current.callMs.samples[0])),
    coldGpuCompletionMs: summarize(values(report => report.current.gpuCompletionMs.samples[0])),
    warmCallP50Ms: summarize(values(report => report.current.callMs.p50)),
    warmGpuCompletionP50Ms: summarize(values(report => report.current.gpuCompletionMs.p50)),
    coldTotalMs: summarize(values(report =>
      report.current.callMs.samples[0] + report.current.gpuCompletionMs.samples[0]
    )),
    warmTotalP50Ms: summarize(values(report =>
      report.current.callMs.p50 + report.current.gpuCompletionMs.p50
    )),
    gpuProcessDeltaKb: summarize(values(report =>
      processWorkingSet(report, 'current', 'GPU') - processWorkingSet(report, 'baseline', 'GPU')
    )),
    tabProcessDeltaKb: summarize(values(report =>
      processWorkingSet(report, 'current', 'Tab') - processWorkingSet(report, 'baseline', 'Tab')
    ))
  },
  vello: {
    coldCallMs: summarize(values(report => report.vello.callMs.samples[0])),
    coldGpuCompletionMs: summarize(values(report => report.vello.gpuCompletionMs.samples[0])),
    warmCallP50Ms: summarize(values(report => report.vello.callMs.p50)),
    warmGpuCompletionP50Ms: summarize(values(report => report.vello.gpuCompletionMs.p50)),
    wasmRawBytes: wasmBytes.byteLength,
    wasmGzipBytes: gzipSync(wasmBytes).byteLength,
    coldTotalMs: summarize(values(report =>
      report.vello.callMs.samples[0] + report.vello.gpuCompletionMs.samples[0]
    )),
    warmTotalP50Ms: summarize(values(report =>
      report.vello.callMs.p50 + report.vello.gpuCompletionMs.p50
    )),
    gpuProcessIncrementalDeltaKb: summarize(values(report =>
      processWorkingSet(report, 'vello', 'GPU') - processWorkingSet(report, 'current', 'GPU')
    )),
    tabProcessIncrementalDeltaKb: summarize(values(report =>
      processWorkingSet(report, 'vello', 'Tab') - processWorkingSet(report, 'current', 'Tab')
    ))
  },
  phaseMetrics: reports.map(report => report.phaseMetrics),
  gpuFeatureStatus: reports[0].gpuFeatureStatus
};
await writeFile(path.join(root, 'BACKEND_BAKEOFF_EVIDENCE.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
