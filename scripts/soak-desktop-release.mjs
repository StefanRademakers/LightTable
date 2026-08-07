import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { assessStableTail, provisionalWindowsTargets, resolveReleaseSoakPlan } from './release-soak-policy.mjs';

const execFileAsync = promisify(execFile);
const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const plan = resolveReleaseSoakPlan({
  profile: argument('profile') ?? 'ci',
  durationMinutes: argument('duration-minutes'),
  cycles: argument('cycles'),
  iterations: argument('iterations')
});
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(argument('output') ?? path.join(workspace, 'tmp', 'quality-audit', 'release-soak', stamp));
const work = path.join(output, 'work');
const reportPath = path.join(output, 'report.json');
const packagedExecutable = path.resolve(argument('packaged-executable')
  ?? path.join(workspace, 'apps', 'desktop', 'out', 'LightTable-win32-x64', 'LightTable.exe'));
const fixtures = [
  { kind: 'ordinary-image', path: 'D:\\adamus2__0002.png' },
  { kind: 'text-psd', path: 'D:\\TextTest.psd' },
  { kind: 'shape-psd', path: 'D:\\shapes.psd' },
  { kind: 'pdf', path: 'D:\\FormulierPersoneel.pdf' },
  {
    kind: 'large-template-psd',
    path: 'D:\\mediavibe\\LightTableTestFiles\\psd\\templates\\Save the Date Invitation PSD 6\\EHS-396\\EHS-396\\EHS-396.psd'
  }
].map((fixture) => ({ ...fixture, path: path.resolve(fixture.path) }));

const command = (id, script, args = []) => ({ id, script: path.join(workspace, 'scripts', script), args });
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const bounded = (value, maximum = 64 * 1024) => value.length <= maximum
  ? value : `${value.slice(0, maximum)}\n[log truncated at ${maximum} characters]\n`;

const runNode = (step, logPath) => new Promise((resolve) => {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let log = '';
  const child = spawn(process.execPath, [step.script, ...step.args], {
    cwd: workspace,
    env: { ...process.env, LIGHTTABLE_TEST_EXECUTABLE: packagedExecutable },
    windowsHide: true,
    shell: false
  });
  child.stdout.on('data', (chunk) => { log += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { log += chunk; process.stderr.write(chunk); });
  child.on('error', (error) => { log += `${error.stack ?? error.message}\n`; });
  child.on('close', async (exitCode) => {
    await writeFile(logPath, bounded(log), 'utf8');
    resolve({
      id: step.id, status: exitCode === 0 ? 'passed' : 'failed', exitCode,
      startedAt, durationMs: Math.round((performance.now() - started) * 10) / 10,
      logPath
    });
  });
});

const windowsJson = async (script) => {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true, maxBuffer: 1024 * 1024
    });
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch { return null; }
};

const lightTableProcesses = async () => {
  const rows = await windowsJson(
    "@(Get-CimInstance Win32_Process | Where-Object { ($_.Name -match '^(electron|LightTable)\\.exe$') -and $_.CommandLine -like '*LightTable*' } | Select-Object ProcessId,Name,CommandLine) | ConvertTo-Json -Compress"
  );
  return rows == null ? [] : Array.isArray(rows) ? rows : [rows];
};

await Promise.all([mkdir(output, { recursive: true }), mkdir(work, { recursive: true })]);
await access(packagedExecutable).catch((error) => {
  throw new Error(`Packaged LightTable executable is missing: ${packagedExecutable}\n${error}`);
});
for (const fixture of fixtures) await access(fixture.path).catch((error) => {
  throw new Error(`Required release-soak fixture is missing: ${fixture.kind} (${fixture.path})\n${error}`);
});

const packageJson = await readJson(path.join(workspace, 'package.json'));
const desktopPackage = await readJson(path.join(workspace, 'apps', 'desktop', 'package.json'));
const videoControllers = await windowsJson(
  '@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,VideoModeDescription) | ConvertTo-Json -Compress'
);
const osInfo = await windowsJson(
  'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | ConvertTo-Json -Compress'
);
const processors = os.cpus();
const startedAt = Date.now();
const deadline = plan.durationMinutes > 0 ? startedAt + plan.durationMinutes * 60_000 : Infinity;
const beforeProcesses = await lightTableProcesses();
const report = {
  schemaVersion: 1,
  generatedAt: new Date(startedAt).toISOString(),
  validity: {
    buildMode: 'production-packaged',
    executable: packagedExecutable,
    workspaceVersion: packageJson.version,
    electronVersion: desktopPackage.devDependencies?.electron ?? null,
    commit: await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace, windowsHide: true })
      .then(({ stdout }) => stdout.trim()).catch(() => null),
    worktreeDirty: await execFileAsync('git', ['status', '--porcelain'], { cwd: workspace, windowsHide: true })
      .then(({ stdout }) => Boolean(stdout.trim())).catch(() => null),
    host: {
      platform: process.platform, architecture: process.arch, os: osInfo ?? os.version(),
      cpu: processors[0]?.model ?? null, logicalCpuCount: processors.length,
      totalRamBytes: os.totalmem(), gpu: videoControllers ?? { status: 'unavailable' }
    }
  },
  plan,
  targets: provisionalWindowsTargets,
  fixtures,
  measurementLanes: {
    inputToSubmit: 'Type Tool trace; explicit validity and sample count.',
    gpuCompletion: 'Type Tool queue completion trace; never substituted with encode time.',
    finalSettle: 'Canvas action duration through two post-action animation frames.',
    firstUsefulFrame: 'Per-document startup phase metadata after ready.',
    retention: 'Forced-GC stable-tail heap, owned GPU estimate, DOM and listeners.',
    background: 'Render telemetry after reset and 750 ms unchanged idle window.'
  },
  cycles: [],
  processBaseline: beforeProcesses.map(({ ProcessId, Name }) => ({ processId: ProcessId, name: Name }))
};

let cycleIndex = 0;
while (cycleIndex < plan.maximumCycles && (cycleIndex === 0 || Date.now() < deadline)) {
  cycleIndex += 1;
  const cycleStarted = performance.now();
  const stressReportPath = path.join(work, 'stress.json');
  const stressArgs = ['--iterations', String(plan.stressIterations), '--output', stressReportPath,
    '--actions', 'layers,zoom,pan,panels,paint'];
  for (const fixture of fixtures) stressArgs.push('--file', fixture.path);
  const steps = [
    command('document-matrix', 'stress-desktop-editor.mjs', stressArgs),
    command('canvas-and-transform', 'audit-desktop-canvas-interactions.mjs', [fixtures[2].path]),
    command('text-caret-edit', 'smoke-desktop-type-tool.mjs', [fixtures[0].path]),
    command('layer-styles', 'audit-desktop-layer-style-interaction.mjs'),
    command('save-export', 'smoke-desktop-accessibility.mjs'),
    command('psd-roundtrip', 'smoke-desktop-psd-roundtrip.mjs', [fixtures[1].path]),
    ...(cycleIndex === 1 ? [command('bounded-diagnostics', 'smoke-desktop-diagnostics.mjs')] : [])
  ];
  const cycle = { index: cycleIndex, startedAt: new Date().toISOString(), steps: [] };
  for (const step of steps) {
    const result = await runNode(step, path.join(output, `cycle-${cycleIndex}-${step.id}.log`));
    cycle.steps.push(result);
    if (result.status !== 'passed') break;
  }
  const stress = await readJson(stressReportPath).catch(() => null);
  cycle.documentMatrix = stress ? assessStableTail(stress.files ?? [])
    : { passed: false, reasons: ['Document matrix report is missing.'] };
  cycle.display = stress?.files?.[0]?.samples?.[0]?.environment ?? {
    status: 'unavailable', reason: 'No ready renderer environment sample was produced.'
  };
  cycle.screenshots = await Promise.all((stress?.files ?? []).map(async (file) => {
    const last = file.samples?.at(-1);
    const bytes = file.screenshot
      ? await stat(file.screenshot).then(({ size }) => size).catch(() => null) : null;
    const valid = bytes != null && bytes > 1_000 && last && !last.runtimeStopped
      && Number.isFinite(last.gpuBytes) && last.gpuBytes > 0;
    return {
      sourceFile: file.sourceFile,
      path: file.screenshot ?? null,
      bytes,
      status: valid ? 'valid' : 'invalid',
      reason: valid ? null : 'Screenshot was missing, empty, early, stopped or lacked a positive settled GPU sample.'
    };
  }));
  const invalidScreenshots = cycle.screenshots.filter(({ status }) => status !== 'valid');
  if (invalidScreenshots.length) {
    cycle.documentMatrix = {
      passed: false,
      reasons: [...cycle.documentMatrix.reasons,
        ...invalidScreenshots.map(({ sourceFile }) => `${sourceFile}: invalid settled screenshot`)]
    };
  }
  cycle.firstUsefulFrames = stress?.files?.map(({ sourceFile, firstUsefulFrame }) => ({ sourceFile, ...firstUsefulFrame })) ?? [];
  cycle.stableTails = stress?.files?.map(({ sourceFile, growth, background }) => ({ sourceFile, growth, background })) ?? [];
  const typeReport = await readJson(path.join(workspace, 'tmp', 'type-tool-smoke', 'type-tool.json')).catch(() => null);
  cycle.textLatency = typeReport?.performanceTelemetry
    ?? { status: 'unavailable', reason: 'Type Tool report is missing.' };
  cycle.durationMs = Math.round((performance.now() - cycleStarted) * 10) / 10;
  cycle.passed = cycle.steps.length === steps.length
    && cycle.steps.every(({ status }) => status === 'passed') && cycle.documentMatrix.passed
    && cycle.textLatency.status === 'available' && cycle.textLatency.samples > 0;
  report.cycles.push(cycle);
  if (cycleIndex === 1) {
    const diagnostics = await readJson(path.join(workspace, 'tmp', 'diagnostic-smoke', 'png-diagnostics.json'))
      .catch(() => null);
    report.boundedDiagnosticSummary = diagnostics ? {
      schemaVersion: diagnostics.schemaVersion,
      release: diagnostics.release,
      host: diagnostics.host,
      gpu: diagnostics.gpu,
      collection: diagnostics.collection,
      privacy: diagnostics.privacy
    } : { status: 'unavailable', reason: 'The bounded diagnostic smoke did not produce a bundle.' };
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!cycle.passed) break;
}

await new Promise((resolve) => setTimeout(resolve, 1500));
const afterProcesses = await lightTableProcesses();
const baselineIds = new Set(beforeProcesses.map(({ ProcessId }) => ProcessId));
report.orphanProcesses = afterProcesses
  .filter(({ ProcessId }) => !baselineIds.has(ProcessId))
  .map(({ ProcessId, Name, CommandLine }) => ({ processId: ProcessId, name: Name, commandLine: CommandLine }));
report.completedAt = new Date().toISOString();
report.elapsedMs = Date.now() - startedAt;
report.extrapolation = plan.profile === 'overnight'
  ? { status: 'measured', requestedHours: plan.durationMinutes / 60 }
  : {
      status: 'not-measured',
      statement: `This ${plan.profile} run covered ${report.cycles.length} cycle(s); it is not evidence of a twelve-hour pass. Run --profile overnight on each claimed hardware class.`
    };
report.passed = report.cycles.length > 0 && report.cycles.every(({ passed }) => passed)
  && report.orphanProcesses.length === 0;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(`LightTable release soak ${report.passed ? 'passed' : 'failed'}: ${reportPath}`);
if (!report.passed) process.exitCode = 1;
