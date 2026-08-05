import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const root = path.resolve(argument('--root', 'D:\\Mediavibe\\LightTableTests\\BlendColorMatrix'));
const blendRoot = path.resolve(argument('--blend-root', 'D:\\Mediavibe\\LightTableTests\\BlendModes'));
const directories = Object.fromEntries([
  'photoshop-canonical', 'photoshop', 'lighttable', 'difference', 'compare', 'runtime'
].map((name) => [name, path.join(root, name)]));
await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })));

const baseCases = [
  { id: 'normal', mode: 'normal', opacity: 1, fillOpacity: 1 },
  { id: 'normal-opacity-50', mode: 'normal', opacity: 0.5, fillOpacity: 1 },
  { id: 'multiply', mode: 'multiply', opacity: 1, fillOpacity: 1 },
  { id: 'screen', mode: 'screen', opacity: 1, fillOpacity: 1 },
  { id: 'overlay', mode: 'overlay', opacity: 1, fillOpacity: 1 },
  { id: 'color', mode: 'color', opacity: 1, fillOpacity: 1 },
  { id: 'color-dodge', mode: 'color-dodge', opacity: 1, fillOpacity: 1 },
  { id: 'hard-mix', mode: 'hard-mix', opacity: 1, fillOpacity: 1 }
];
const profiles = [
  { id: 'untagged', photoshopName: '', embed: false },
  { id: 'srgb', photoshopName: 'sRGB IEC61966-2.1', embed: true },
  { id: 'adobe-rgb', photoshopName: 'Adobe RGB (1998)', embed: true }
];
const cases = [];
const jobs = [];
for (const base of baseCases) for (const profile of profiles) for (const bitDepth of [8, 16]) {
  const id = `${base.id}-${profile.id}-${bitDepth}`;
  const source = path.join(blendRoot, 'source', `${base.id}.psd`);
  const canonical = path.join(directories['photoshop-canonical'], `${id}.psd`);
  const reference = path.join(directories.photoshop, `${id}.png`);
  const lightTable = path.join(directories.lighttable, `${id}.png`);
  const difference = path.join(directories.difference, `${id}.png`);
  const compare = path.join(directories.compare, `${id}.png`);
  cases.push({
    ...base, id, layerName: `Blend ${base.id}`, profile: profile.id, bitDepth, source, canonical,
    reference, lightTable, difference, compare
  });
  jobs.push([source, canonical, reference, profile.photoshopName, bitDepth,
    profile.embed ? '1' : '0'].join('|'));
}
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({
  schema: 2,
  generatedAt: new Date().toISOString(),
  root,
  canvas: { width: 400, height: 400 },
  profiles: profiles.map(({ id }) => id),
  bitDepths: [8, 16],
  cases
}, null, 2)}\n`);
await writeFile(path.join(root, 'photoshop-jobs.txt'), `${jobs.join('\n')}\n`);
process.stdout.write(`Prepared ${cases.length} Photoshop color-matrix jobs in ${root}\n`);
