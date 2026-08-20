import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'packages', 'command-contract', 'catalog.json');
const parameterPropertiesPath = path.join(root, 'packages', 'command-contract', 'parameter-properties.json');
const examplesPath = path.join(root, 'packages', 'command-contract', 'examples.json');
const modulePath = path.join(root, 'packages', 'command-contract', 'src', 'index.mjs');
const declarationPath = path.join(root, 'packages', 'command-contract', 'src', 'index.d.ts');
const check = process.argv.includes('--check');

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const parameterProperties = JSON.parse(await readFile(parameterPropertiesPath, 'utf8'));
const commandExamples = JSON.parse(await readFile(examplesPath, 'utf8'));
if (catalog.protocolVersion !== 1 || !Array.isArray(catalog.commands) || catalog.commands.length === 0) {
  throw new Error('The LightTable command catalog must define protocol v1 and at least one command.');
}
if (catalog.agentAccessPolicy?.target !== 'all-user-facing-functionality'
  || catalog.agentAccessPolicy?.rollout !== 'capability-gated-incremental') {
  throw new Error('The command catalog must preserve LightTable\'s complete, incremental agent-access direction.');
}

const ids = catalog.commands.map(({ id }) => id);
if (ids.some((id) => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== ids.length) {
  throw new Error('The LightTable command catalog contains an invalid or duplicate command ID.');
}
const propertyIds = Object.keys(parameterProperties);
const unknownExampleIds = Object.keys(commandExamples).filter((id) => !ids.includes(id));
if (unknownExampleIds.length > 0) {
  throw new Error(`Command examples reference unknown IDs: ${unknownExampleIds.join(', ')}.`);
}
for (const [id, examples] of Object.entries(commandExamples)) {
  if (!Array.isArray(examples) || examples.length < 1 || examples.length > 8
    || examples.some((example) => typeof example !== 'object' || example === null || Array.isArray(example))) {
    throw new Error(`The command ${id} has invalid examples.`);
  }
}
const missingProperties = ids.filter((id) => !Object.hasOwn(parameterProperties, id));
const orphanProperties = propertyIds.filter((id) => !ids.includes(id));
if (missingProperties.length > 0 || orphanProperties.length > 0) {
  throw new Error(`Command parameter property drift. Missing: ${missingProperties.join(', ') || 'none'}; orphaned: ${orphanProperties.join(', ') || 'none'}.`);
}
for (const command of catalog.commands) {
  const properties = parameterProperties[command.id];
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)
    || Object.entries(properties).some(([name, type]) => !name || typeof type !== 'string' || !type)) {
    throw new Error(`The command ${command.id} has an invalid parameter property map.`);
  }
  if (command.invocation === 'direct' && Object.keys(properties).length > 0) {
    throw new Error(`Direct command ${command.id} may not advertise parameters.`);
  }
  if (command.invocation === 'parameters' && Object.keys(properties).length === 0) {
    throw new Error(`Parameterized command ${command.id} must advertise at least one property.`);
  }
}
for (const command of catalog.commands) {
  if (typeof command.category !== 'string' || typeof command.label !== 'string'
    || typeof command.description !== 'string'
    || !['workspace', 'document'].includes(command.scope)
    || !['presentation', 'edit', 'external-io', 'control'].includes(command.effect)
    || !['direct', 'parameters'].includes(command.invocation)) {
    throw new Error(`The command ${command.id} has incomplete Actions metadata.`);
  }
  if (typeof command.agentAccess !== 'boolean'
    || ![null, 'execute', 'dedicated'].includes(command.externalMcp)) {
    throw new Error(`The command ${command.id} has invalid exposure metadata.`);
  }
  if (command.externalMcp !== null && !command.agentAccess) {
    throw new Error(`External MCP command ${command.id} is absent from the Agent Access profile.`);
  }
  if (!command.agentAccess && typeof command.agentAccessReason !== 'string') {
    throw new Error(`The command ${command.id} needs an Agent Access exclusion reason.`);
  }
  if (command.externalMcp === null && typeof command.externalMcpReason !== 'string') {
    throw new Error(`The command ${command.id} needs an external MCP exclusion reason.`);
  }
  if (command.atomicBatch !== undefined && typeof command.atomicBatch !== 'boolean') {
    throw new Error(`The command ${command.id} has invalid atomic-batch metadata.`);
  }
  if (command.atomicBatch === true && command.externalMcp !== 'execute') {
    throw new Error(`Atomic batch command ${command.id} must be an externally executable command.`);
  }
}

const agentAccess = catalog.commands.filter(({ agentAccess: exposed }) => exposed).map(({ id }) => id);
const externalExecute = catalog.commands.filter(({ externalMcp }) => externalMcp === 'execute').map(({ id }) => id);
const externalDedicated = catalog.commands.filter(({ externalMcp }) => externalMcp === 'dedicated').map(({ id }) => id);
const batchOperations = catalog.commands.filter(({ atomicBatch }) => atomicBatch === true).map(({ id }) => id);
const literal = (values) => `[\n${values.map((value) => `  '${value}'`).join(',\n')}\n]`;

const moduleSource = `// Generated from ../catalog.json by scripts/generate-command-contract.mjs.\n`
  + `// Do not edit this file directly.\n\n`
  + `import commandCatalog from '../catalog.json' with { type: 'json' };\n\n`
  + `import parameterProperties from '../parameter-properties.json' with { type: 'json' };\n\n`
  + `import commandExamples from '../examples.json' with { type: 'json' };\n\n`
  + `export const LIGHTTABLE_COMMAND_PROTOCOL_VERSION = ${catalog.protocolVersion};\n\n`
  + `export const LIGHTTABLE_COMMAND_IDS = Object.freeze(${literal(ids)});\n\n`
  + `export const LIGHTTABLE_COMMAND_DEFINITIONS = Object.freeze(commandCatalog.commands);\n\n`
  + `export const LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES = Object.freeze(parameterProperties);\n\n`
  + `export const LIGHTTABLE_COMMAND_EXAMPLES = Object.freeze(commandExamples);\n\n`
  + `export const LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS = Object.freeze(${literal(agentAccess)});\n\n`
  + `export const LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS = Object.freeze(${literal(externalExecute)});\n\n`
  + `export const LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS = Object.freeze(${literal(externalDedicated)});\n\n`
  + `export const LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS = Object.freeze(${literal(batchOperations)});\n\n`
  + `const commandIds = new Set(LIGHTTABLE_COMMAND_IDS);\n`
  + `const agentAccessCommandIds = new Set(LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS);\n\n`
  + `export const isLightTableCommandId = (value) => typeof value === 'string' && commandIds.has(value);\n`
  + `export const isLightTableAgentAccessCommandId = (value) => typeof value === 'string' && agentAccessCommandIds.has(value);\n`;

const tupleDeclaration = (name, values) => `export declare const ${name}: readonly [\n`
  + values.map((value) => `  '${value}'`).join(',\n') + `\n];\n\n`;
const declarationSource = `// Generated from ../catalog.json by scripts/generate-command-contract.mjs.\n`
  + `// Do not edit this file directly.\n\n`
  + `export declare const LIGHTTABLE_COMMAND_PROTOCOL_VERSION: ${catalog.protocolVersion};\n\n`
  + tupleDeclaration('LIGHTTABLE_COMMAND_IDS', ids)
  + `export type LightTableCommandId = typeof LIGHTTABLE_COMMAND_IDS[number];\n\n`
  + `export type LightTableCommandCategory = 'document' | 'image' | 'view' | 'layer' | 'effects' | 'file' | 'text' | 'vector' | 'selection' | 'automation' | 'history';\n`
  + `export interface LightTableCommandDefinition { readonly id: LightTableCommandId; readonly category: LightTableCommandCategory; readonly label: string; readonly description: string; readonly scope: 'workspace' | 'document'; readonly effect: 'presentation' | 'edit' | 'external-io' | 'control'; readonly invocation: 'direct' | 'parameters'; readonly agentAccess: boolean; readonly agentAccessReason?: string; readonly externalMcp: 'execute' | 'dedicated' | null; readonly externalMcpReason?: string; readonly atomicBatch?: boolean; }\n`
  + `export declare const LIGHTTABLE_COMMAND_DEFINITIONS: readonly LightTableCommandDefinition[];\n\n`
  + `export type LightTableCommandParameterProperties = Readonly<Record<string, string>>;\n`
  + `export declare const LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES: Readonly<Record<LightTableCommandId, LightTableCommandParameterProperties>>;\n\n`
  + `export declare const LIGHTTABLE_COMMAND_EXAMPLES: Readonly<Partial<Record<LightTableCommandId, readonly Readonly<Record<string, unknown>>[]>>>;\n\n`
  + tupleDeclaration('LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS', agentAccess)
  + `export type LightTableAgentAccessCommandId = typeof LIGHTTABLE_AGENT_ACCESS_COMMAND_IDS[number];\n\n`
  + tupleDeclaration('LIGHTTABLE_EXTERNAL_MCP_EXECUTE_COMMAND_IDS', externalExecute)
  + tupleDeclaration('LIGHTTABLE_EXTERNAL_MCP_DEDICATED_COMMAND_IDS', externalDedicated)
  + tupleDeclaration('LIGHTTABLE_EXTERNAL_MCP_BATCH_OPERATION_IDS', batchOperations)
  + `export declare const isLightTableCommandId: (value: unknown) => value is LightTableCommandId;\n`
  + `export declare const isLightTableAgentAccessCommandId: (value: unknown) => value is LightTableAgentAccessCommandId;\n`;

const outputs = [[modulePath, moduleSource], [declarationPath, declarationSource]];
if (check) {
  const stale = [];
  for (const [outputPath, expected] of outputs) {
    const actual = await readFile(outputPath, 'utf8').catch(() => null);
    if (actual !== expected) stale.push(path.relative(root, outputPath));
  }
  if (stale.length > 0) throw new Error(`Generated command contract is stale: ${stale.join(', ')}`);
  process.stdout.write('LightTable command contract is current.\n');
} else {
  for (const [outputPath, source] of outputs) await writeFile(outputPath, source, 'utf8');
  process.stdout.write('Generated LightTable command contract.\n');
}
