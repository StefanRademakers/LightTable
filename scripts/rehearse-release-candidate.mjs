import { spawn } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const runCapture = (command, args, options = {}) => new Promise((resolve) => {
  let stdout = ''; let stderr = '';
  const child = spawn(command, args, { cwd: options.cwd ?? root, env: options.env ?? process.env,
    windowsHide: true, shell: false });
  child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
  child.once('error', (error) => resolve({ status: 'failed', exitCode: null, stdout, stderr: `${stderr}\n${error.stack ?? error.message}` }));
  child.once('close', (code) => resolve({ status: code === 0 ? 'passed' : 'failed', exitCode: code, stdout, stderr }));
});
const gitValue = async (...args) => {
  const result = await runCapture('git', args);
  if (result.status !== 'passed') throw new Error(`git ${args.join(' ')} failed.`);
  return result.stdout.trim();
};

const requestedCommit = argument('commit', await gitValue('rev-parse', 'HEAD'));
const commit = await gitValue('rev-parse', `${requestedCommit}^{commit}`);
const short = commit.slice(0, 12);
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.resolve(argument('output', path.join(root, 'tmp', 'release-candidate', `${short}-${stamp}`)));
const checkout = path.join(output, 'checkout');
await mkdir(output, { recursive: true });
const worktree = await runCapture('git', ['worktree', 'add', '--detach', checkout, commit]);
if (worktree.status !== 'passed') throw new Error('Could not create the detached release-candidate checkout.');
const checkoutStatus = await runCapture('git', ['status', '--porcelain'], { cwd: checkout });
if (checkoutStatus.stdout.trim()) throw new Error('Detached release-candidate checkout is not clean.');

const environment = { ...process.env,
  PATH: `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH ?? ''}` };
const stages = [
  { id: 'full-quality', script: 'run-quality-gates.mjs', args: ['--profile', 'full', '--iterations', argument('iterations', '2'), '--output', path.join(output, 'quality')] },
  { id: 'owner-acceptance-automation', script: 'run-owner-acceptance.mjs', args: ['--skip-package', '--output', path.join(output, 'owner-acceptance')] },
  { id: 'hardware-probe', script: 'probe-hardware-qualification.mjs', args: ['--output', path.join(output, 'hardware')] },
  { id: 'commercial-lifecycle', script: 'rehearse-commercial-lifecycle.mjs', args: ['--output', path.join(output, 'commercial')] }
];
const results = [];
for (const stage of stages) {
  const started = performance.now();
  const result = await runCapture(process.execPath, [path.join(checkout, 'scripts', stage.script), ...stage.args], {
    cwd: checkout, env: environment
  });
  const logPath = path.join(output, `${stage.id}.log`);
  await writeFile(logPath, `${result.stdout}\n${result.stderr}`, 'utf8');
  results.push({ id: stage.id, status: result.status, exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started), logPath });
  if (result.status !== 'passed') break;
}

const owner = await readFile(path.join(output, 'owner-acceptance', 'report.json'), 'utf8')
  .then(JSON.parse).catch(() => null);
const commercial = await readFile(path.join(output, 'commercial', 'report.json'), 'utf8')
  .then(JSON.parse).catch(() => null);
const automatedPass = results.length === stages.length && results.every(({ status }) => status === 'passed');
const blockers = [
  ...(!owner?.ownerSignoff ? ['Owner acceptance sign-off is pending.'] : []),
  ...(!commercial?.commercialReady ? ['Commercial policy/activation/installer gates are open.'] : []),
  'Integrated-GPU, web-host and Apple Silicon physical qualification is open.',
  'A multi-hour soak was not executed by this bounded rehearsal.'
];
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), candidateCommit: commit,
  candidateVersion: JSON.parse(await readFile(path.join(checkout, 'package.json'), 'utf8')).version,
  cleanDetachedCheckout: true, automatedPass, ownerSignoff: owner?.ownerSignoff === true,
  releaseClassification: automatedPass ? 'bounded-technical-preview' : 'no-release',
  paidReleaseCandidate: automatedPass && blockers.length === 0,
  blockers, stages: results
};
const payload = Buffer.from(JSON.stringify(report));
const keys = generateKeyPairSync('ed25519');
const signature = sign(null, payload, keys.privateKey);
if (!verify(null, payload, keys.publicKey, signature)) throw new Error('RC evidence signature self-verification failed.');
const publicKey = createPublicKey(keys.privateKey).export({ format: 'der', type: 'spki' });
await Promise.all([
  writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  writeFile(path.join(output, 'report.signature.json'), `${JSON.stringify({
    algorithm: 'Ed25519', trust: 'ephemeral-local-evidence',
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
    publicKeySpkiBase64: publicKey.toString('base64'), signatureBase64: signature.toString('base64')
  }, null, 2)}\n`, 'utf8')
]);
process.stdout.write(`Release-candidate rehearsal ${automatedPass ? 'passed' : 'failed'}: ${path.join(output, 'report.json')}\n`);
if (!automatedPass) process.exitCode = 1;
