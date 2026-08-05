import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const sourceRoot = path.resolve(process.argv[2]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\layer-effects-roundtrip');
const outputRoot = path.resolve(process.argv[3]
  ?? 'D:\\Mediavibe\\LightTableTests\\Effects');
const requestedIds = new Set((process.argv[4] ?? '').split(',')
  .map((value) => value.trim()).filter(Boolean));
const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'));
await mkdir(outputRoot, { recursive: true });

const normalize = async (file) => sharp(file)
  .flatten({ background: '#d9dde4' })
  .resize(400, 400, { fit: 'contain', background: '#d9dde4' })
  .removeAlpha()
  .png()
  .toBuffer();

const results = [];
for (const entry of manifest.cases.filter(({ id }) => !requestedIds.size || requestedIds.has(id))) {
  const lightTable = path.join(sourceRoot, 'lighttable', `${entry.id}-import.png`);
  const photoshop = entry.reference;
  const output = path.join(outputRoot, `${entry.id}.png`);
  const [left, right] = await Promise.all([normalize(lightTable), normalize(photoshop)]);
  await sharp({ create: { width: 800, height: 400, channels: 3, background: '#d9dde4' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 400, top: 0 }])
    .png()
    .toFile(output);
  results.push({ id: entry.id, family: entry.family, parameters: entry.parameters,
    order: ['LightTable', 'Photoshop'], lightTable, photoshop, output });
}

await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
  schema: 1,
  generatedAt: new Date().toISOString(),
  layout: { width: 800, height: 400, left: 'LightTable', right: 'Photoshop' },
  results
}, null, 2)}\n`);
process.stdout.write(`Created ${results.length} LT | Photoshop effect comparisons in ${outputRoot}\n`);
