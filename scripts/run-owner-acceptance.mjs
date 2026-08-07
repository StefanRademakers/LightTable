import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const output = path.resolve(argument('output', path.join(workspace, 'tmp', 'owner-acceptance')));
const selected = new Set(argument('projects', '').split(',').map((value) => value.trim()).filter(Boolean));
const skipPackage = process.argv.includes('--skip-package');
const packagedExecutable = path.resolve(argument('packaged-executable', path.join(
  workspace, 'apps', 'desktop', 'out', 'LightTable-win32-x64', 'LightTable.exe'
)));
const manifest = JSON.parse(await readFile(path.join(workspace, 'test', 'acceptance', 'owner-workflows.json'), 'utf8'));
const projects = manifest.projects.filter(({ id }) => selected.size === 0 || selected.has(id));
await mkdir(output, { recursive: true });

const run = (command, args, logPath, timeoutMs = 240_000, environment = process.env) => new Promise((resolve) => {
  const started = performance.now(); let log = ''; let timedOut = false;
  const child = spawn(command, args, { cwd: workspace, env: environment, windowsHide: true });
  child.stdout.on('data', (chunk) => { log += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { log += chunk; process.stderr.write(chunk); });
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  child.once('error', async (error) => {
    clearTimeout(timeout); log += `${error.stack ?? error.message}\n`;
    await writeFile(logPath, log, 'utf8'); resolve({ passed: false, timedOut, durationMs: performance.now() - started });
  });
  child.once('close', async (code) => {
    clearTimeout(timeout); await writeFile(logPath, log, 'utf8');
    resolve({ passed: code === 0 && !timedOut, exitCode: code, timedOut, durationMs: performance.now() - started });
  });
});

const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), featureFreeze: true,
  ownerSignoff: false, projects: [], defects: [] };
if (!skipPackage) {
  const npm = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm', 'run', 'package:desktop:verify']
    : ['run', 'package:desktop:verify'];
  const packaged = await run(npm, args, path.join(output, 'package.log'), 300_000);
  if (!packaged.passed) throw new Error('Owner acceptance packaging failed.');
}
await access(packagedExecutable).catch(() => {
  throw new Error(`Owner acceptance requires the packaged executable: ${packagedExecutable}`);
});
const automationEnvironment = {
  ...process.env,
  LIGHTTABLE_TEST_EXECUTABLE: packagedExecutable
};
report.buildMode = 'production-packaged';
report.executable = packagedExecutable;

for (const project of projects) {
  const result = { id: project.id, title: project.title, fixture: project.fixture,
    canvasPolicy: project.canvasPolicy, automation: [], ownerReview: {
      correctness: null, perceivedLatency: null, discoverability: null, visualPolish: null,
      undoTrust: null, recoveryConfidence: null, exportFidelity: null, notes: ''
    } };
  report.projects.push(result);
  const missing = [];
  for (const required of project.requiredFiles) {
    await access(path.resolve(required)).catch(() => missing.push(required));
  }
  if (missing.length) {
    result.status = 'blocked-missing-fixture'; result.missing = missing;
    report.defects.push({ id: `acceptance-${project.id}-fixture`, severity: 'P1', workflow: project.id,
      expected: 'The declared acceptance fixture is locally available.', evidence: missing,
      owner: 'release-engineering', regressionRoute: 'Fixture manifest preflight' });
    continue;
  }
  for (const [index, automation] of project.automation.entries()) {
    const projectOutput = path.join(output, project.id);
    await mkdir(projectOutput, { recursive: true });
    const args = automation.args.map((value) => value.replaceAll('{output}', projectOutput));
    const execution = await run(process.execPath, [path.join(workspace, 'scripts', automation.script), ...args],
      path.join(projectOutput, `${index}-${automation.script}.log`), 240_000, automationEnvironment);
    result.automation.push({ script: automation.script, args, ...execution });
    if (!execution.passed) report.defects.push({ id: `acceptance-${project.id}-${automation.script}`,
      severity: 'P1', workflow: project.id, expected: `${automation.script} completes without errors.`,
      evidence: path.relative(workspace, path.join(projectOutput, `${index}-${automation.script}.log`)),
      owner: 'workflow-runtime', regressionRoute: automation.script });
  }
  result.status = result.automation.every(({ passed }) => passed)
    ? 'awaiting-owner-review' : 'failed';
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

report.automationPassed = report.projects.every(({ status }) => status === 'awaiting-owner-review');
report.releaseStatus = report.automationPassed ? 'pending-owner-signoff' : 'blocked-by-automation';
const checklist = [
  '# LightTable owner acceptance checklist', '',
  `Generated: ${report.generatedAt}`, '',
  `Automation: ${report.automationPassed ? 'PASS' : 'FAIL'}`, '',
  'Feature freeze is active. Check every category after performing the project task in the packaged build.', ''
];
for (const project of projects) {
  const status = report.projects.find(({ id }) => id === project.id)?.status ?? 'not-run';
  checklist.push(`## ${project.title}`, '', `Automated status: **${status}**`, '',
    `Fixture: ${project.fixture}`, '', `Owner task: ${project.ownerTask}`, '',
    '- [ ] Correctness', '- [ ] Perceived latency', '- [ ] Discoverability',
    '- [ ] Visual polish', '- [ ] Undo trust', '- [ ] Recovery confidence',
    '- [ ] Export fidelity', '- [ ] No undisclosed raster/cache fallback', '', 'Notes:', '');
}
checklist.push('## Sign-off', '', '- [ ] I approve interaction feel.', '- [ ] I approve visual quality.',
  '- [ ] I approve the documented deferrals and release classification.', '', 'Owner/date:', '');
await Promise.all([
  writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(path.join(output, 'owner-checklist.md'), `${checklist.join('\n')}\n`, 'utf8'),
  writeFile(path.join(output, 'defects.json'), `${JSON.stringify(report.defects, null, 2)}\n`, 'utf8')
]);
if (!report.automationPassed) throw new Error(`Owner acceptance automation failed: ${path.join(output, 'report.json')}`);
process.stdout.write(`Owner acceptance automation passed; owner sign-off remains required: ${output}\n`);
