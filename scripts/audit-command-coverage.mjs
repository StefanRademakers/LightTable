import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const menuPath = path.join(root, 'packages', 'lighttable-app', 'src', 'lighttable',
  'editor', 'menus', 'createEditorMenuOptions.ts');
const mappingPath = path.join(root, 'architecture', 'tests', 'action-coverage', 'editor-menus.json');
const reportPath = path.join(root, 'audit', 'USER_ACTION_COMMAND_COVERAGE.md');
const listOnly = process.argv.includes('--list');
const write = process.argv.includes('--write');

const source = await readFile(menuPath, 'utf8');
const sourceFile = ts.createSourceFile(menuPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const staticActions = new Map();
const dynamicActions = [];

const propertyName = (property) => {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return null;
};

const inspect = (node) => {
  if (ts.isObjectLiteralExpression(node)) {
    const onClick = node.properties.find((property) => propertyName(property) === 'onClick');
    if (onClick) {
      const value = node.properties.find((property) => propertyName(property) === 'value');
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (value && ts.isPropertyAssignment(value) && ts.isStringLiteral(value.initializer)) {
        const id = value.initializer.text;
        const lines = staticActions.get(id) ?? [];
        lines.push(line);
        staticActions.set(id, lines);
      } else if (value && ts.isPropertyAssignment(value)) {
        dynamicActions.push({ expression: value.initializer.getText(sourceFile), line });
      } else {
        dynamicActions.push({ expression: '<missing value>', line });
      }
    }
  }
  ts.forEachChild(node, inspect);
};
inspect(sourceFile);

const ids = [...staticActions.keys()].sort();
if (listOnly) {
  process.stdout.write(`${ids.join('\n')}\n`);
  process.stdout.write(`Static executable menu actions: ${ids.length}; dynamic definitions: ${dynamicActions.length}.\n`);
  for (const entry of dynamicActions) process.stdout.write(`${entry.line}: ${entry.expression}\n`);
  process.exit(0);
}

const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
if (mapping.version !== 1 || !Array.isArray(mapping.actions)) {
  throw new Error('Editor menu action coverage must contain version 1 and an actions array.');
}
if (!Array.isArray(mapping.dynamicActions)) {
  throw new Error('Editor menu action coverage needs a dynamicActions array.');
}
const catalog = JSON.parse(await readFile(path.join(root, 'packages', 'command-contract', 'catalog.json'), 'utf8'));
const commandIds = new Set(catalog.commands.map(({ id }) => id));
const mapped = new Map(mapping.actions.map((entry) => [entry.id, entry]));
const missing = ids.filter((id) => !mapped.has(id));
const stale = [...mapped.keys()].filter((id) => !staticActions.has(id));
if (missing.length || stale.length) {
  throw new Error(`Editor menu coverage drift. Missing: ${missing.join(', ') || 'none'}. Stale: ${stale.join(', ') || 'none'}.`);
}
const dynamicByExpression = new Map(mapping.dynamicActions.map((entry) => [entry.expression, entry]));
const missingDynamic = dynamicActions.filter(({ expression }) => !dynamicByExpression.has(expression));
const staleDynamic = [...dynamicByExpression.keys()]
  .filter((expression) => !dynamicActions.some((entry) => entry.expression === expression));
if (missingDynamic.length || staleDynamic.length) {
  throw new Error(`Dynamic editor menu coverage drift. Missing: ${missingDynamic.map(({ expression }) => expression).join(', ') || 'none'}. Stale: ${staleDynamic.join(', ') || 'none'}.`);
}

const commandClassifications = new Set(['command', 'command-owner']);
for (const entry of mapping.actions) {
  if (![...commandClassifications, 'host', 'presentation', 'gap'].includes(entry.classification)) {
    throw new Error(`Invalid classification for ${entry.id}.`);
  }
  if (commandClassifications.has(entry.classification) && !commandIds.has(entry.command)) {
    throw new Error(`${entry.id} maps to unknown command ${entry.command}.`);
  }
  if (!commandClassifications.has(entry.classification)
      && (typeof entry.reason !== 'string' || !entry.reason.trim())) {
    throw new Error(`${entry.id} needs a reason for ${entry.classification} classification.`);
  }
}
for (const entry of mapping.dynamicActions) {
  if (![...commandClassifications, 'host', 'presentation', 'gap'].includes(entry.classification)) {
    throw new Error(`Invalid dynamic classification for ${entry.expression}.`);
  }
  if (commandClassifications.has(entry.classification) && !commandIds.has(entry.command)) {
    throw new Error(`${entry.expression} maps to unknown command ${entry.command}.`);
  }
  if (!commandClassifications.has(entry.classification)
      && (typeof entry.reason !== 'string' || !entry.reason.trim())) {
    throw new Error(`${entry.expression} needs a reason for ${entry.classification} classification.`);
  }
}

const groups = new Map();
for (const entry of [...mapping.actions, ...mapping.dynamicActions]) {
  const entries = groups.get(entry.classification) ?? [];
  entries.push(entry);
  groups.set(entry.classification, entries);
}
const gapEntries = groups.get('gap') ?? [];
const ownerCount = groups.get('command-owner')?.length ?? 0;
const rows = mapping.actions.map((entry) => {
  const target = commandClassifications.has(entry.classification) ? `\`${entry.command}\`` : entry.reason;
  return `| \`${entry.id}\` | ${entry.classification} | ${target} | ${staticActions.get(entry.id).join(', ')} |`;
});
const dynamicRows = mapping.dynamicActions.map((entry) => {
  const target = commandClassifications.has(entry.classification) ? `\`${entry.command}\`` : entry.reason;
  const sourceEntry = dynamicActions.find(({ expression }) => expression === entry.expression);
  return `| \`${entry.expression.replaceAll('`', '\\`')}\` | ${entry.classification} | ${target} | ${sourceEntry.line} |`;
});
const report = `# User action / command coverage\n\n`
  + `Generated from the central editor menu on ${new Date().toISOString().slice(0, 10)}. `
  + `This is the first checked surface, not complete application coverage.\n\n`
  + `## Current measured surface\n\n`
  + `- ${ids.length} unique static executable menu actions plus ${dynamicActions.length} dynamic families;\n`
  + `- ${groups.get('command')?.length ?? 0} already routed through semantic commands;\n`
  + `- ${ownerCount} ${ownerCount === 1 ? 'has' : 'have'} a semantic command but still ${ownerCount === 1 ? 'bypasses' : 'bypass'} it in this UI path;\n`
  + `- ${groups.get('host')?.length ?? 0} host/workspace operations;\n`
  + `- ${groups.get('presentation')?.length ?? 0} presentation-only operations;\n`
  + `- ${gapEntries.length} genuine semantic command gaps;\n`
  + `- ${dynamicActions.length} checked dynamic menu families.\n\n`
  + `## Meaning\n\n`
  + `A command-owner entry has a catalog command and canonical implementation, but this UI path still calls `
  + `the owner directly; an Actions recorder would therefore miss it. A gap means the user can perform the `
  + `operation through the normal UI but the central semantic command catalog cannot yet express it. `
  + `Host and presentation classifications are not automatically MCP edits, `
  + `but still need an explicit agent product decision later.\n\n`
  + `## Menu inventory\n\n`
  + `| Menu action | Classification | Command or reason | Source line(s) |\n`
  + `| --- | --- | --- | --- |\n${rows.join('\n')}\n\n`
  + `## Dynamic menu families\n\n`
  + `| Value expression | Classification | Command or reason | Source line |\n`
  + `| --- | --- | --- | --- |\n${dynamicRows.join('\n')}\n`;

if (write) await writeFile(reportPath, report, 'utf8');
process.stdout.write(`Editor menu coverage passed: ${ids.length} actions, ${gapEntries.length} gaps.${write ? ` Report: ${reportPath}` : ''}\n`);
