import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(root, 'tmp', 'commercial-lifecycle'));
await mkdir(output, { recursive: true });

const forbiddenCredentialVariables = [
  'LIGHTTABLE_BRIDGE_TOKEN', 'LIGHTTABLE_DEVICE_PAIRING_CODE', 'LIGHTTABLE_PAIRING_CODE',
  'LIGHTTABLE_PROBE_SIGNING_KEY', 'LIGHTTABLE_UPDATE_PRIVATE_KEY_FILE'
];
const presentCredentials = forbiddenCredentialVariables.filter((name) => Boolean(process.env[name]));
if (presentCredentials.length) {
  throw new Error(`Commercial rehearsal refuses production-capable credentials: ${presentCredentials.join(', ')}`);
}

const filesBelow = async (directory) => {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(resolved));
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) result.push(resolved);
  }
  return result;
};
const documentRuntimeRoots = [
  'packages/lighttable-app/src/lighttable/editor/document',
  'packages/lighttable-app/src/lighttable/editor/persistence',
  'packages/lighttable-app/src/lighttable/editor/rendering',
  'packages/lighttable-app/src/lighttable/gpu'
].map((relative) => path.join(root, relative));
const entitlementCoupling = [];
for (const file of (await Promise.all(documentRuntimeRoots.map(filesBelow))).flat()) {
  const source = await readFile(file, 'utf8');
  if (/\b(?:entitlement|activation receipt|commercial lifecycle)\b/iu.test(source)) {
    entitlementCoupling.push(path.relative(root, file));
  }
}

const policy = JSON.parse(await readFile(path.join(root, 'architecture', 'contracts', 'COMMERCIAL_LIFECYCLE_POLICY.json'), 'utf8'));
const steps = [
  {
    id: 'offline-update-recovery-privacy-mcp', command: process.execPath,
    args: [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
      'apps/desktop/src/releaseUpdate.test.ts',
      'apps/desktop/src/recoveryStore.test.ts',
      'apps/desktop/src/agentTunnel.test.ts',
      'packages/lighttable-app/src/standalone/requestWorkspaceDocumentClose.test.ts',
      'packages/lighttable-app/src/lighttable/application/diagnostics/supportDiagnosticBundle.test.ts',
      'packages/lighttable-app/src/lighttable/application/diagnostics/localBetaDiagnostics.test.ts']
  },
  { id: 'packaged-save-export-accessibility', command: process.execPath, args: [path.join(root, 'scripts', 'smoke-desktop-accessibility.mjs')] },
  { id: 'packaged-private-diagnostics', command: process.execPath, args: [path.join(root, 'scripts', 'smoke-desktop-diagnostics.mjs')] },
  { id: 'packaged-recovery', command: process.execPath, args: [path.join(root, 'scripts', 'smoke-desktop-recovery.mjs')] }
];

const results = [];
for (const step of steps) {
  const started = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(step.command, step.args, {
      cwd: root, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024
    });
    results.push({ id: step.id, status: 'passed', durationMs: Math.round(performance.now() - started),
      outputTail: `${stdout}\n${stderr}`.trim().split(/\r?\n/u).slice(-8) });
  } catch (reason) {
    const error = reason;
    results.push({ id: step.id, status: 'failed', durationMs: Math.round(performance.now() - started),
      exitCode: error.code ?? null, outputTail: `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim().split(/\r?\n/u).slice(-20) });
    break;
  }
}

const technicalPass = entitlementCoupling.length === 0
  && results.length === steps.length && results.every(({ status }) => status === 'passed');
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  productionCredentialsUsed: false,
  documentEntitlementCoupling: entitlementCoupling,
  policyReviewState: policy.reviewState,
  technicalPass,
  commercialReady: false,
  blockers: [
    'Owner/legal commercial policy review is not complete.',
    'Signed activation receipt verification is not implemented.',
    'Production installer update and rollback providers are not configured.',
    'Design-partner cohort exit review and hardware qualification are open.'
  ],
  steps: results
};
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`Commercial lifecycle rehearsal ${technicalPass ? 'passed technically' : 'failed'}: ${path.join(output, 'report.json')}\n`);
if (!technicalPass) process.exitCode = 1;
