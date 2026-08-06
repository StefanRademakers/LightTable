import { _electron as electron } from 'playwright-core';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const output = path.resolve(argument('output', path.join(workspace, 'tmp', 'hardware-qualification')));
const fixture = path.resolve(argument('fixture', 'D:/shapes.psd'));
const executable = path.join(workspace, 'apps', 'desktop', 'out', 'LightTable-win32-x64', 'LightTable.exe');
const userData = path.join(output, 'user-data');
await Promise.all([access(executable), access(fixture), mkdir(userData, { recursive: true })]);

const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData,
  LIGHTTABLE_AUTOMATION_OPEN_FILE: fixture };
delete environment.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: executable, env: environment, timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.lighttable-toolbar__meta').filter({ hasText: /ready/i })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('tab', { name: 'Debug', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const diagnostics = JSON.parse(await page.locator('.lighttable-debug-panel__preview').textContent());
  const gpuInfo = await app.evaluate(async ({ app: electronApp }) => electronApp.getGPUInfo('basic'));
  const featureStatus = await app.evaluate(({ app: electronApp }) => electronApp.getGPUFeatureStatus());
  const activeGpu = gpuInfo.gpuDevice?.find?.((device) => device.active) ?? gpuInfo.gpuDevice?.[0] ?? {};
  const display = await page.evaluate(() => ({
    scale: devicePixelRatio,
    widthBucket: Math.round(screen.width / 320) * 320,
    heightBucket: Math.round(screen.height / 180) * 180,
    colorDepth: screen.colorDepth
  }));
  const totalGiB = os.totalmem() / (1024 ** 3);
  const report = {
    schema: 'com.lighttable.hardware-qualification', schemaVersion: 1,
    generatedAt: new Date().toISOString(), benchmarkRevision: 1,
    privacy: { documentContent: false, fileNames: false, paths: false, hostName: false,
      userName: false, networkIdentifiers: false },
    host: { kind: 'electron', platform: process.platform, architecture: process.arch,
      osRelease: os.release(), logicalCpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? 'unknown', memoryGiBBucket: Math.max(4, Math.round(totalGiB / 4) * 4) },
    display,
    gpu: {
      vendorId: activeGpu.vendorId ?? null, deviceId: activeGpu.deviceId ?? null,
      driverVendor: activeGpu.driverVendor ?? null, driverVersion: activeGpu.driverVersion ?? null,
      description: diagnostics.gpu?.value?.description ?? null,
      limits: diagnostics.gpu?.value?.limits ?? null,
      features: diagnostics.gpu?.value?.features ?? [],
      featureStatus
    },
    support: diagnostics.gpu?.value?.support ?? { id: 'unavailable', label: 'WebGPU probe unavailable' },
    validity: { packagedBuild: true, webGpuInitialized: diagnostics.gpu?.status === 'available',
      sourceFixtureRecorded: false }
  };
  const payload = Buffer.from(JSON.stringify(report));
  const configured = process.env.LIGHTTABLE_PROBE_SIGNING_KEY
    ? createPrivateKey({ key: Buffer.from(process.env.LIGHTTABLE_PROBE_SIGNING_KEY, 'base64'), format: 'der', type: 'pkcs8' })
    : generateKeyPairSync('ed25519').privateKey;
  const publicKey = configured.asymmetricKeyType === 'ed25519'
    ? createPublicKey(configured) : null;
  if (!publicKey) throw new Error('Hardware probe signing key must be Ed25519.');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const signedBytes = sign(null, payload, configured);
  if (!verify(null, payload, publicKey, signedBytes)) throw new Error('Hardware probe signature verification failed.');
  const signature = {
    algorithm: 'Ed25519', trust: process.env.LIGHTTABLE_PROBE_SIGNING_KEY ? 'configured-release-key' : 'ephemeral-local',
    keyId: createHash('sha256').update(publicDer).digest('hex'), publicKeySpkiBase64: publicDer.toString('base64'),
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
    signatureBase64: signedBytes.toString('base64'), verifiedBeforeWrite: true
  };
  await Promise.all([
    writeFile(path.join(output, 'probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(path.join(output, 'probe.signature.json'), `${JSON.stringify(signature, null, 2)}\n`, 'utf8')
  ]);
  process.stdout.write(`Signed hardware probe written: ${output}\n`);
} finally {
  await app?.close().catch(() => undefined);
}
