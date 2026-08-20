import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const menuPath = path.join(root, 'packages', 'lighttable-app', 'src', 'lighttable',
  'editor', 'menus', 'createEditorMenuOptions.ts');
const toolRegistryPath = path.join(root, 'packages', 'lighttable-app', 'src', 'lighttable',
  'editor', 'tools', 'toolRegistry.ts');
const toolAutomationPath = path.join(root, 'packages', 'lighttable-app', 'src', 'lighttable',
  'application', 'tools', 'toolAutomationCatalog.ts');
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

const variableInitializer = (file, name) => {
  let initializer = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && node.name.text === name) initializer = node.initializer ?? null;
    if (!initializer) ts.forEachChild(node, visit);
  };
  visit(file);
  return initializer;
};

const stringValue = (node) => (
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
);
const stringArray = (node) => ts.isArrayLiteralExpression(node)
  ? node.elements.map(stringValue).filter((value) => value !== null) : null;
const objectProperty = (node, name) => ts.isObjectLiteralExpression(node)
  ? node.properties.find((property) => propertyName(property) === name) : null;
const propertyInitializer = (property) => property && ts.isPropertyAssignment(property)
  ? property.initializer : null;
const unwrapExpression = (node) => {
  let current = node;
  while (current && (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isParenthesizedExpression(current))) current = current.expression;
  return current;
};

const readToolDefinitions = async () => {
  const toolSource = await readFile(toolRegistryPath, 'utf8');
  const file = ts.createSourceFile(toolRegistryPath, toolSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = unwrapExpression(variableInitializer(file, 'TOOL_DEFINITIONS'));
  if (!declaration || !ts.isArrayLiteralExpression(declaration)) {
    throw new Error('Could not inspect TOOL_DEFINITIONS.');
  }
  return declaration.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) throw new Error('Tool definitions must be object literals.');
    const id = stringValue(propertyInitializer(objectProperty(element, 'id')));
    const label = stringValue(propertyInitializer(objectProperty(element, 'label')));
    const role = stringValue(propertyInitializer(objectProperty(element, 'role')));
    if (!id || !label || !role) throw new Error('Each tool needs literal id, label and role values.');
    return { id, label, role };
  });
};

const readToolAutomation = async () => {
  const automationSource = await readFile(toolAutomationPath, 'utf8');
  const file = ts.createSourceFile(toolAutomationPath, automationSource,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = unwrapExpression(variableInitializer(file, 'TOOL_AUTOMATION_CATALOG'));
  if (!declaration || !ts.isObjectLiteralExpression(declaration)) {
    throw new Error('Could not inspect TOOL_AUTOMATION_CATALOG.');
  }
  return declaration.properties.map((property) => {
    const id = propertyName(property);
    if (!id || !ts.isPropertyAssignment(property)) {
      throw new Error('Tool automation entries must use literal properties.');
    }
    const value = property.initializer;
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
      const helper = value.expression.text;
      const presentation = helper === 'presentation';
      if (!presentation && helper !== 'owner' && helper !== 'uiCommand') {
        throw new Error(`Unknown tool automation helper ${helper} for ${id}.`);
      }
      const capabilities = presentation ? [] : stringArray(value.arguments[1]);
      const note = stringValue(value.arguments[presentation ? 0 : 2]);
      const interaction = presentation ? 'presentation' : stringValue(value.arguments[0]);
      if (!capabilities || !note || !interaction) throw new Error(`Invalid tool automation entry ${id}.`);
      return { id, interaction, availability: presentation ? 'presentation-only'
        : helper === 'owner' ? 'canonical-owner-only' : 'ui-and-command', capabilities, note };
    }
    if (!ts.isObjectLiteralExpression(value)) throw new Error(`Invalid tool automation entry ${id}.`);
    const interaction = stringValue(propertyInitializer(objectProperty(value, 'interaction')));
    const availability = stringValue(propertyInitializer(objectProperty(value, 'availability')));
    const capabilities = stringArray(propertyInitializer(objectProperty(value, 'capabilities')));
    const note = stringValue(propertyInitializer(objectProperty(value, 'note')));
    if (!interaction || !availability || !capabilities || !note) {
      throw new Error(`Invalid explicit tool automation entry ${id}.`);
    }
    return { id, interaction, availability, capabilities, note };
  });
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
const toolDefinitions = await readToolDefinitions();
const toolAutomation = await readToolAutomation();
const registeredToolIds = new Set(toolDefinitions.map(({ id }) => id));
const automatedToolIds = new Set(toolAutomation.map(({ id }) => id));
const missingTools = toolDefinitions.filter(({ id }) => !automatedToolIds.has(id));
const staleTools = toolAutomation.filter(({ id }) => !registeredToolIds.has(id));
if (missingTools.length || staleTools.length || automatedToolIds.size !== toolAutomation.length) {
  throw new Error(`Toolbar automation coverage drift. Missing: ${missingTools.map(({ id }) => id).join(', ') || 'none'}. `
    + `Stale/duplicate: ${staleTools.map(({ id }) => id).join(', ') || 'none'}.`);
}
const toolAvailability = new Set(['presentation-only', 'ui-and-command', 'playback-command-only',
  'canonical-owner-only', 'not-exposed']);
const toolInteractions = new Set(['presentation', 'discrete', 'continuous']);
for (const entry of toolAutomation) {
  if (!toolAvailability.has(entry.availability) || !toolInteractions.has(entry.interaction)) {
    throw new Error(`Invalid toolbar automation classification for ${entry.id}.`);
  }
  if (entry.availability === 'presentation-only' && entry.interaction !== 'presentation') {
    throw new Error(`Presentation-only tool ${entry.id} must have presentation interaction semantics.`);
  }
  if (entry.availability === 'ui-and-command' && entry.capabilities.length === 0) {
    throw new Error(`UI/command tool ${entry.id} needs at least one semantic capability.`);
  }
  for (const capability of entry.capabilities) {
    const command = capability.split(':', 1)[0];
    if (!commandIds.has(command)) throw new Error(`${entry.id} maps to unknown command ${capability}.`);
  }
}
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
const toolById = new Map(toolAutomation.map((entry) => [entry.id, entry]));
const toolbarRows = toolDefinitions.map((definition) => {
  const entry = toolById.get(definition.id);
  return `| \`${definition.id}\` | ${definition.role} | ${entry.interaction} | ${entry.availability} | `
    + `${entry.capabilities.length ? entry.capabilities.map((value) => `\`${value}\``).join(', ') : 'none'} | ${entry.note} |`;
});
const toolOwnerOnly = toolAutomation.filter(({ availability }) => availability === 'canonical-owner-only');
const toolNotExposed = toolAutomation.filter(({ availability }) => availability === 'not-exposed');
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
  + `| --- | --- | --- | --- |\n${dynamicRows.join('\n')}\n\n`
  + `## Toolbar inventory\n\n`
  + `- ${toolDefinitions.length} registered tools;\n`
  + `- ${toolAutomation.filter(({ availability }) => availability === 'ui-and-command').length} have a recorded UI/command route;\n`
  + `- ${toolOwnerOnly.length} have a canonical owner but no proven UI/command vertical;\n`
  + `- ${toolNotExposed.length} are explicitly not exposed.\n\n`
  + `| Tool | Role | Interaction | Availability | Capability | Note |\n`
  + `| --- | --- | --- | --- | --- | --- |\n${toolbarRows.join('\n')}\n`;

if (write) await writeFile(reportPath, report, 'utf8');
process.stdout.write(`Editor/menu toolbar coverage passed: ${ids.length} menu actions, ${gapEntries.length} menu gaps, `
  + `${toolDefinitions.length} tools, ${toolOwnerOnly.length + toolNotExposed.length} tool gaps/withheld.${write ? ` Report: ${reportPath}` : ''}\n`);
