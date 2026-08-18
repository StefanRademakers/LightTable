import { _electron as electron } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { attachLightTableAutomation } from './lighttable-automation-driver.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = path.resolve(argument('source') ?? 'D:\\people.jpg');
const root = path.resolve(argument('root') ?? 'D:\\mediavibe\\LightTableTests\\GradeCurvesParity');
const casePath = path.resolve(argument('cases') ?? path.join(import.meta.dirname, 'grade-curves-parity-cases.json'));
const outputDirectory = path.join(root, 'lighttable');
const executable = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'runtime', `lighttable-${process.pid}`);
await Promise.all([access(source), access(casePath), access(executable), mkdir(outputDirectory, { recursive: true }), mkdir(userData, { recursive: true })]);
const suite = JSON.parse(await readFile(casePath, 'utf8'));
const mimeByExtension = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.tif', 'image/tiff'], ['.tiff', 'image/tiff']]);
const environment = { ...process.env, LIGHTTABLE_AUTOMATION_USER_DATA: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: executable, args: [path.join(workspace, 'apps', 'desktop')], cwd: workspace, env: environment, timeout: 30_000 });
const results = [];

try {
  const page = await app.firstWindow({ timeout: 30_000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  const driver = await attachLightTableAutomation(page, 'grade-curves-parity', 30_000);
  const bytes = await readFile(source);
  const artifact = await driver.registerInputArtifact(bytes, path.basename(source), mimeByExtension.get(path.extname(source).toLowerCase()) ?? 'application/octet-stream');
  const opened = await driver.executeWorkspace('file.openArtifact', { artifactId: artifact.id });
  const documentId = opened.value?.documentId;
  if (!documentId) throw new Error('Curves source open did not return a document ID.');
  await driver.waitForDocument(documentId, 120_000);
  const trigger = page.getByRole('button', { name: 'New fill or processing layer' });
  await trigger.click();
  await page.getByRole('menu', { name: 'New fill or processing layer' }).getByRole('menuitem', { name: 'New Grade layer', exact: true }).click();
  const panel = page.getByLabel('Grade Layer properties', { exact: true }).last();
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const groupToggle = panel.getByRole('button', { name: 'Custom Curves', exact: true });
  if (await groupToggle.getAttribute('aria-expanded') === 'false') await groupToggle.click();
  const editor = panel.locator('.lighttable-curves-editor');
  const channelLabels = { master: 'RGB', red: 'R', green: 'G', blue: 'B' };

  const selectChannel = async (channel) => {
    await editor.getByRole('radio', { name: channelLabels[channel], exact: true }).click();
    await editor.getByRole('application', { name: `${channel} custom curve` }).waitFor({ state: 'visible' });
  };
  const resetAll = async () => {
    for (const channel of Object.keys(channelLabels)) {
      await selectChannel(channel);
      await editor.getByTitle(`Reset ${channel} curve`).click();
    }
  };
  const position = (box, point) => ({
    x: box.x + (12 + point[0] / 255 * 256) / 280 * box.width,
    y: box.y + (12 + (1 - point[1] / 255) * 186) / 210 * box.height
  });
  const setCurve = async (channel, points) => {
    await selectChannel(channel);
    const graph = editor.getByRole('application', { name: `${channel} custom curve` });
    const box = await graph.boundingBox();
    if (!box) throw new Error(`${channel} curve graph has no bounds.`);
    const circles = graph.locator('.lighttable-curves-editor__point');
    const endpoints = [points[0], points.at(-1)];
    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const expected = endpoint ? [255, 255] : [0, 0];
      if (endpoints[endpoint][0] === expected[0] && endpoints[endpoint][1] === expected[1]) continue;
      const circle = circles.nth(endpoint ? await circles.count() - 1 : 0);
      const current = await circle.boundingBox();
      if (!current) throw new Error(`${channel} endpoint has no bounds.`);
      const target = position(box, endpoints[endpoint]);
      await page.mouse.move(current.x + current.width / 2, current.y + current.height / 2);
      await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 4 }); await page.mouse.up();
    }
    for (const point of points.slice(1, -1)) {
      const target = position(box, point);
      await page.mouse.click(target.x, target.y);
    }
  };

  for (const entry of suite.cases) {
    await resetAll();
    for (const [channel, points] of Object.entries(entry.curves)) await setCurve(channel, points);
    const exported = await driver.execute(documentId, 'file.exportPng', {}, { requireCompleted: false });
    const task = await driver.waitForTask(documentId, exported.taskId, 120_000);
    const png = await driver.readArtifact(task.artifact.id);
    const output = path.join(outputDirectory, `${entry.id}.png`);
    await writeFile(output, png.bytes);
    results.push({ ...entry, baselineId: 'neutral', isBaseline: entry.id === 'neutral', output });
    process.stdout.write(`LightTable ${entry.id}: ${output}\n`);
  }
  if (pageErrors.length) throw new Error(`LightTable runtime errors: ${pageErrors.join('\n')}`);
} finally { await app.close().catch(() => {}); }

await writeFile(path.join(outputDirectory, 'capture-report.json'), `${JSON.stringify({
  schema: 1, generatedAt: new Date().toISOString(), section: suite.section, source,
  isolation: 'One decoded source and one topmost Grade Layer are reused; all four channels reset before each declared curve case.', cases: results
}, null, 2)}\n`);
