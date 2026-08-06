import { spawn } from 'node:child_process';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const profile = argument('profile', 'quick');
const validProfiles = new Set(['quick', 'desktop', 'parity', 'full']);
if (!validProfiles.has(profile)) {
  throw new Error(`Unknown quality profile '${profile}'. Use quick, desktop, parity or full.`);
}
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(argument('output', path.join(workspace, 'tmp', 'quality-gates', stamp)));
const node = process.execPath;
await mkdir(output, { recursive: true });

const steps = [];
const add = (id, command, args, options = {}) => steps.push({ id, command, args, ...options });
const addNpm = (id, args, options = {}) => process.platform === 'win32'
  ? add(id, process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
    ['/d', '/s', '/c', 'npm', ...args], options)
  : add(id, 'npm', args, options);

if (profile === 'quick' || profile === 'full') {
  addNpm('boundaries', ['run', 'verify:boundary']);
  addNpm('typecheck', ['run', 'typecheck']);
  addNpm('unit-tests', ['test']);
  addNpm('web-production-build', ['run', 'build:web']);
}

if (profile === 'desktop' || profile === 'full') {
  addNpm('desktop-production-build', ['run', 'package:desktop:verify']);
  const discovered = (await readdir(path.join(workspace, 'scripts')))
    .filter((name) => /^smoke-desktop-.*\.mjs$/u.test(name))
    .sort();
  for (const name of discovered) {
    add(`desktop-${name.replace(/^smoke-desktop-|\.mjs$/gu, '')}`,
      node, [path.join(workspace, 'scripts', name)]);
  }
  add('desktop-endurance', node, [path.join(workspace, 'scripts', 'stress-desktop-editor.mjs'),
    '--iterations', argument('iterations', '6')]);
  add('desktop-style-interaction', node,
    [path.join(workspace, 'scripts', 'audit-desktop-layer-style-interaction.mjs')]);
  add('desktop-tool-switching', node,
    [path.join(workspace, 'scripts', 'audit-desktop-tool-switching.mjs'),
      '--iterations', argument('iterations', '6')]);
}

if (profile === 'parity' || profile === 'full') {
  const effectsRoot = path.resolve(argument('effects-root',
    'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip'));
  const blendRoot = path.resolve(argument('blend-root',
    'D:\\Mediavibe\\LightTableTests\\BlendColorMatrix'));
  addNpm('desktop-production-build', ['run', 'package:desktop:verify'], { deduplicate: true });
  add('photoshop-layer-effects', node,
    [path.join(workspace, 'scripts', 'audit-psd-layer-effects-corpus.mjs'),
      '--root', effectsRoot, '--strict', '--report', path.join(output, 'layer-effects.json')],
    { requiredPath: path.join(effectsRoot, 'manifest.json') });
  add('photoshop-blend-color', node,
    [path.join(workspace, 'scripts', 'audit-psd-blend-mode-corpus.mjs'),
      '--root', blendRoot, '--max-rmse', argument('max-rmse', '3'),
      '--report', path.join(output, 'blend-color.json')],
    { requiredPath: path.join(blendRoot, 'manifest.json') });
}

const uniqueSteps = steps.filter((step, index) => !step.deduplicate
  || steps.findIndex((candidate) => candidate.id === step.id) === index);
const results = [];

const run = (step) => new Promise((resolve) => {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let log = '';
  const child = spawn(step.command, step.args, {
    cwd: workspace,
    env: { ...process.env },
    shell: false,
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString(); log += text; process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString(); log += text; process.stderr.write(text);
  });
  child.on('error', (error) => {
    log += `${error.stack ?? error.message}\n`;
    resolve({ status: 'failed', exitCode: null, error: error.message });
  });
  child.on('close', (exitCode) => resolve({
    status: exitCode === 0 ? 'passed' : 'failed', exitCode,
    startedAt, durationMs: Math.round((performance.now() - started) * 10) / 10,
    log
  }));
});

for (const step of uniqueSteps) {
  if (step.requiredPath) {
    await access(step.requiredPath).catch(() => {
      throw new Error(`Required quality corpus is missing: ${step.requiredPath}`);
    });
  }
  process.stdout.write(`\n[LightTable quality] ${step.id}\n`);
  const result = await run(step);
  const logPath = path.join(output, `${step.id}.log`);
  await writeFile(logPath, result.log ?? '', 'utf8');
  results.push({ id: step.id, status: result.status, exitCode: result.exitCode,
    startedAt: result.startedAt, durationMs: result.durationMs, logPath });
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify({
    schemaVersion: 1, profile, generatedAt: new Date().toISOString(), results
  }, null, 2)}\n`, 'utf8');
  if (result.status !== 'passed') {
    throw new Error(`Quality gate '${step.id}' failed. See ${logPath}`);
  }
}

process.stdout.write(`\nQuality profile '${profile}' passed. Report: ${path.join(output, 'report.json')}\n`);
