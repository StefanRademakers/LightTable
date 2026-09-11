import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const inventory = readJson('architecture/tests/editor-command-route-inventory.json');
const catalog = readJson(inventory.catalog);
const degradations = readJson('architecture/tests/product-degradation-allowlist.json');
const failures = [];

for (const route of inventory.routes) {
  if (!fs.existsSync(path.join(root, route.owner))) failures.push(`missing route owner: ${route.owner}`);
}
for (const command of catalog.commands) {
  const owners = inventory.routes.filter(({ idPattern }) => new RegExp(idPattern).test(command.id));
  if (owners.length !== 1) failures.push(`${command.id}: expected one terminal owner, found ${owners.length}`);
}
for (const entry of degradations.entries) {
  for (const field of ['id', 'owner', 'test', 'reason', 'nonMutationInvariant']) {
    if (!entry[field]) failures.push(`product degradation is missing ${field}`);
  }
  if (!fs.existsSync(path.join(root, entry.owner))) failures.push(`${entry.id}: missing owner ${entry.owner}`);
  if (!fs.existsSync(path.join(root, entry.test))) failures.push(`${entry.id}: missing test ${entry.test}`);
}
if (failures.length) {
  console.error('Editor route manifest check failed:\n' + failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`Editor route manifest is complete (${catalog.commands.length} commands, ${degradations.entries.length} documented product degradations).`);
