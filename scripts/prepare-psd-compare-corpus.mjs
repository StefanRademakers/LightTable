import { createHash } from 'node:crypto';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const outputRoot = path.resolve(process.argv[2]
  ?? 'D:\\Mediavibe\\LightTableTests\\PsdCompare');
const templateRoot = path.resolve(process.argv[3]
  ?? 'D:\\mediavibe\\LightTableTestFiles\\psd\\templates');
const optionalFiles = ['D:\\TextTest.psd', 'D:\\shapes.psd'];

const collect = async (directory) => {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await collect(absolute));
    else if (/\.ps[db]$/i.test(entry.name)) results.push(absolute);
  }
  return results;
};
const exists = async (file) => access(file).then(() => true, () => false);
const slug = (file) => {
  const stem = path.basename(file, path.extname(file)).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const digest = createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 8);
  return `${stem || 'document'}-${digest}`;
};

await Promise.all([
  mkdir(path.join(outputRoot, 'photoshop'), { recursive: true }),
  mkdir(path.join(outputRoot, 'lighttable'), { recursive: true }),
  mkdir(path.join(outputRoot, 'compare'), { recursive: true }),
  mkdir(path.join(outputRoot, 'runtime'), { recursive: true })
]);
const sources = [...await collect(templateRoot),
  ...((await Promise.all(optionalFiles.map(async (file) => await exists(file) ? file : null))).filter(Boolean))]
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
const cases = sources.map((source) => {
  const id = slug(source);
  return {
    id,
    source,
    photoshop: path.join(outputRoot, 'photoshop', `${id}.png`),
    lightTable: path.join(outputRoot, 'lighttable', `${id}.png`),
    output: path.join(outputRoot, 'compare', `${id}.png`)
  };
});
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
  schema: 1, generatedAt: new Date().toISOString(), outputRoot, templateRoot, cases
}, null, 2)}\n`);
await writeFile(path.join(outputRoot, 'photoshop-jobs.txt'),
  `${cases.map(({ source, photoshop }) => `${source}|${photoshop}`).join('\n')}\n`);
process.stdout.write(`Prepared ${cases.length} unique PSD comparison jobs in ${outputRoot}\n`);
