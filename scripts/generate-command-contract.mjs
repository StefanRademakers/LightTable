import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'packages', 'command-contract', 'catalog.json');
const parameterPropertiesPath = path.join(root, 'packages', 'command-contract', 'parameter-properties.json');
const examplesPath = path.join(root, 'packages', 'command-contract', 'examples.json');
const schemasDirectory = path.join(root, 'packages', 'command-contract', 'schemas', 'v1');
const modulePath = path.join(root, 'packages', 'command-contract', 'src', 'index.mjs');
const declarationPath = path.join(root, 'packages', 'command-contract', 'src', 'index.d.ts');
const check = process.argv.includes('--check');

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const parameterProperties = JSON.parse(await readFile(parameterPropertiesPath, 'utf8'));
const commandExamples = JSON.parse(await readFile(examplesPath, 'utf8'));
const schemaFileNames = (await readdir(schemasDirectory))
  .filter((name) => name.endsWith('.json')).sort();
if (schemaFileNames.length === 0) throw new Error('Command schema v1 has no modules.');
const schemaModules = await Promise.all(schemaFileNames.map(async (name) => ({
  name,
  value: JSON.parse(await readFile(path.join(schemasDirectory, name), 'utf8'))
})));
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
if (schemaModules.some(({ value }) => value.schemaVersion !== 1
  || typeof value.commands !== 'object' || value.commands === null)) {
  throw new Error('Every command schema module must define schema version 1 commands.');
}
const schemaIds = schemaModules.flatMap(({ value }) => Object.keys(value.commands));
const duplicateSchemaIds = schemaIds.filter((id, index) => schemaIds.indexOf(id) !== index);
if (duplicateSchemaIds.length > 0) {
  throw new Error(`Command schemas define duplicate IDs: ${[...new Set(duplicateSchemaIds)].join(', ')}.`);
}
const commandSchemas = Object.assign({}, ...schemaModules.map(({ value }) => value.commands));
const unknownSchemaIds = Object.keys(commandSchemas).filter((id) => !ids.includes(id));
if (unknownSchemaIds.length > 0) {
  throw new Error(`Command schemas reference unknown IDs: ${unknownSchemaIds.join(', ')}.`);
}
for (const [id, schema] of Object.entries(commandSchemas)) {
  if (schema?.input?.type !== 'object' || schema?.result?.type !== 'object') {
    throw new Error(`The command ${id} must define object input and result schemas.`);
  }
  const definition = catalog.commands.find((command) => command.id === id);
  if (definition.invocation === 'direct'
    && (Object.keys(schema.input.properties ?? {}).length > 0
      || (schema.input.required?.length ?? 0) > 0)) {
    throw new Error(`Direct command ${id} may only define a closed empty input schema.`);
  }
  const schemaProperties = Object.keys(schema.input.properties ?? {}).sort();
  const advertisedProperties = Object.keys(parameterProperties[id] ?? {})
    .map((name) => name.endsWith('?') ? name.slice(0, -1) : name).sort();
  if (new Set(advertisedProperties).size !== advertisedProperties.length) {
    throw new Error(`The command ${id} has ambiguous legacy property names.`);
  }
  if (JSON.stringify(schemaProperties) !== JSON.stringify(advertisedProperties)) {
    throw new Error(`The command ${id} schema and legacy property discovery have drifted.`);
  }
}
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
const schemaImportName = (name) => `${name.replace(/\.json$/u, '').replace(/[^a-zA-Z0-9]+(.)/gu,
  (_, character) => character.toUpperCase())}CommandSchemas`;
const schemaImports = schemaModules.map(({ name }) =>
  `import ${schemaImportName(name)} from '../schemas/v1/${name}' with { type: 'json' };`).join('\n\n');
const schemaSpreads = schemaModules.map(({ name }) => `  ...schemaModuleCommands(${schemaImportName(name)})`).join(',\n');

const moduleSource = `// Generated from ../catalog.json by scripts/generate-command-contract.mjs.\n`
  + `// Do not edit this file directly.\n\n`
  + `import commandCatalog from '../catalog.json' with { type: 'json' };\n\n`
  + `import parameterProperties from '../parameter-properties.json' with { type: 'json' };\n\n`
  + `import commandExamples from '../examples.json' with { type: 'json' };\n\n`
  + `${schemaImports}\n\n`
  + `export { validateJsonSchemaValue, formatSchemaValidationIssues } from './schema-validation.mjs';\n\n`
  + `const schemaReferences = (value, names = new Set()) => {\n`
  + `  if (Array.isArray(value)) value.forEach((entry) => schemaReferences(entry, names));\n`
  + `  else if (value && typeof value === 'object') {\n`
  + `    const match = typeof value.$ref === 'string' ? value.$ref.match(/^#\\/\\$defs\\/([^/]+)$/u) : null;\n`
  + `    if (match) names.add(match[1]);\n`
  + `    Object.values(value).forEach((entry) => schemaReferences(entry, names));\n`
  + `  }\n`
  + `  return names;\n`
  + `};\n`
  + `const schemaWithDefinitions = (schema, definitions) => {\n`
  + `  const names = schemaReferences(schema);\n`
  + `  for (const name of names) {\n`
  + `    if (!definitions[name]) throw new Error(\`Command schema references missing definition: \${name}.\`);\n`
  + `    schemaReferences(definitions[name], names);\n`
  + `  }\n`
  + `  return names.size > 0 ? { ...schema, $defs: Object.fromEntries(\n`
  + `    [...names].map((name) => [name, definitions[name]])\n`
  + `  ) } : schema;\n`
  + `};\n`
  + `const schemaModuleCommands = (module) => module.$defs\n`
  + `  ? Object.fromEntries(Object.entries(module.commands).map(([id, schema]) => [id, {\n`
  + `      ...schema, input: schemaWithDefinitions(schema.input, module.$defs),\n`
  + `      result: schemaWithDefinitions(schema.result, module.$defs)\n`
  + `    }]))\n`
  + `  : module.commands;\n\n`
  + `export const LIGHTTABLE_COMMAND_PROTOCOL_VERSION = ${catalog.protocolVersion};\n\n`
  + `export const LIGHTTABLE_COMMAND_IDS = Object.freeze(${literal(ids)});\n\n`
  + `export const LIGHTTABLE_COMMAND_DEFINITIONS = Object.freeze(commandCatalog.commands);\n\n`
  + `export const LIGHTTABLE_COMMAND_PARAMETER_PROPERTIES = Object.freeze(parameterProperties);\n\n`
  + `export const LIGHTTABLE_COMMAND_EXAMPLES = Object.freeze(commandExamples);\n\n`
  + `export const LIGHTTABLE_COMMAND_SCHEMA_VERSION = 1;\n\n`
  + `export const LIGHTTABLE_COMMAND_SCHEMAS = Object.freeze({\n`
  + `${schemaSpreads}\n`
  + `});\n\n`
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
  + `export interface LightTableJsonSchema { readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'; readonly title?: string; readonly description?: string; readonly properties?: Readonly<Record<string, LightTableJsonSchema>>; readonly required?: readonly string[]; readonly additionalProperties?: boolean; readonly minProperties?: number; readonly maxProperties?: number; readonly items?: LightTableJsonSchema; readonly enum?: readonly unknown[]; readonly const?: unknown; readonly default?: unknown; readonly minLength?: number; readonly maxLength?: number; readonly pattern?: string; readonly minItems?: number; readonly maxItems?: number; readonly uniqueItems?: boolean; readonly minimum?: number; readonly maximum?: number; readonly allOf?: readonly LightTableJsonSchema[]; readonly anyOf?: readonly LightTableJsonSchema[]; readonly oneOf?: readonly LightTableJsonSchema[]; readonly not?: LightTableJsonSchema; readonly if?: LightTableJsonSchema; readonly then?: LightTableJsonSchema; readonly else?: LightTableJsonSchema; readonly $ref?: string; readonly $defs?: Readonly<Record<string, LightTableJsonSchema>>; readonly 'x-lighttable-control'?: 'layer-id' | 'layer-ids'; readonly 'x-lighttable-step'?: number; }\n`
  + `export interface LightTableCommandSchema { readonly input: LightTableJsonSchema; readonly result: LightTableJsonSchema; }\n`
  + `export interface LightTableSchemaValidationIssue { readonly path: readonly (string | number)[]; readonly code: string; readonly message: string; }\n`
  + `export type LightTableSchemaValidationResult = { readonly valid: true; readonly issues: readonly [] } | { readonly valid: false; readonly issues: readonly LightTableSchemaValidationIssue[] };\n`
  + `export declare const LIGHTTABLE_COMMAND_SCHEMA_VERSION: 1;\n`
  + `export declare const LIGHTTABLE_COMMAND_SCHEMAS: Readonly<Partial<Record<LightTableCommandId, LightTableCommandSchema>>>;\n`
  + `export declare const validateJsonSchemaValue: (schema: LightTableJsonSchema, value: unknown) => LightTableSchemaValidationResult;\n`
  + `export declare const formatSchemaValidationIssues: (issues: readonly LightTableSchemaValidationIssue[]) => string;\n\n`
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
