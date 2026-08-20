const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const identifier = (title) => ({
  type: 'string', title, minLength: 1, maxLength: 128, pattern: '.*\\S.*'
});

const safeName = (value) => value.replace(/[^a-zA-Z0-9]+/gu, '_');
const commandFamily = (command) => command.startsWith('layer.effect.')
  ? 'layer_effect' : safeName(command.split('.')[0]);
const localReference = (name) => ({ $ref: `#/$defs/${name}` });

const rewriteReference = (reference, names) => {
  const match = reference?.match(/^#\/\$defs\/([^/]+)$/u);
  return match ? `#/$defs/${names.get(match[1]) ?? match[1]}` : reference;
};

const transformPredicateSchema = (schema, names) => {
  if (Array.isArray(schema)) return schema.map((entry) => transformPredicateSchema(entry, names));
  if (!record(schema)) return schema;
  return Object.fromEntries(Object.entries(schema).flatMap(([key, value]) => {
    if (key === '$defs') return [];
    if (key === '$ref') return [[key, rewriteReference(value, names)]];
    return [[key, transformPredicateSchema(value, names)]];
  }));
};

const transformSchema = (schema, names, resultReferences, referenceDefinition = null) => {
  if (!record(schema)) return schema;
  const transformed = Object.fromEntries(Object.entries(schema).flatMap(([key, value]) => {
    if (key === '$defs') return [];
    if (key === '$ref') return [[key, rewriteReference(value, names)]];
    if (key === 'properties' && record(value)) return [[key, Object.fromEntries(
      Object.entries(value).map(([name, child]) => [
        name, transformSchema(child, names, resultReferences, resultReferences.get(name) ?? null)
      ])
    )]];
    if (key === 'items') return [[key, transformSchema(value, names, resultReferences)]];
    if (['allOf', 'anyOf', 'oneOf'].includes(key) && Array.isArray(value)) return [[key,
      value.map((branch) => transformSchema(branch, names, resultReferences))
    ]];
    if (['then', 'else'].includes(key)) return [[key,
      transformSchema(value, names, resultReferences)
    ]];
    // Predicates must continue to test the unresolved literal shape. Letting a
    // result reference satisfy `if` or `not` would select a branch before the
    // referenced value exists. The resolved command is validated again by the
    // application owner immediately before execution.
    if (['if', 'not'].includes(key)) return [[key, transformPredicateSchema(value, names)]];
    return [[key, value]];
  }));
  if (!referenceDefinition) return transformed;
  const literal = transformed.not === undefined
    ? { ...transformed, title: transformed.title ?? 'Literal value',
      not: localReference(referenceDefinition) }
    : { title: transformed.title ?? 'Literal value', allOf: [
      transformed, { not: localReference(referenceDefinition) }
    ] };
  return { oneOf: [literal, localReference(referenceDefinition)] };
};

const addNamespacedDefinitions = (schema, prefix, destination, transform, resultReferences) => {
  const source = record(schema.$defs) ? schema.$defs : {};
  const names = new Map(Object.keys(source).map((name) => [name, `${prefix}_${safeName(name)}`]));
  for (const [name, definition] of Object.entries(source)) {
    const transformed = transform
      ? transformSchema(definition, names, resultReferences)
      : transformSchema(definition, names, new Map());
    const targetName = names.get(name);
    if (destination[targetName] !== undefined
      && JSON.stringify(destination[targetName]) !== JSON.stringify(transformed)) {
      throw new Error(`Atomic batch schema definition ${targetName} has conflicting owners.`);
    }
    destination[targetName] = transformed;
  }
  return { schema: transform
    ? transformSchema(schema, names, resultReferences)
    : transformSchema(schema, names, new Map()), names };
};

const requireCommandSchema = (schemas, command) => {
  const schema = schemas[command];
  if (!schema?.input || !schema?.result) {
    throw new Error(`Atomic batch command ${command} has no complete input/result schema.`);
  }
  return schema;
};

export const createCommandBatchSchema = (schemas, commandIds) => {
  if (!record(schemas) || !Array.isArray(commandIds) || commandIds.length < 1) {
    throw new Error('Atomic batch schema generation requires commands and complete schemas.');
  }
  const inputDefinitions = {};
  const resultDefinitions = {};
  const resultFields = [...new Set(commandIds.flatMap((command) => Object.keys(
    requireCommandSchema(schemas, command).result.properties ?? {}
  )))].sort();
  const resultReferences = new Map(resultFields.map((field) => {
    const definition = `batch_result_reference_${safeName(field)}`;
    inputDefinitions[definition] = {
      type: 'object', title: 'Prior operation result', additionalProperties: false,
      properties: {
        resultOf: identifier('Prior operation ID'),
        field: { type: 'string', title: 'Result field', const: field }
      },
      required: ['resultOf', 'field']
    };
    return [field, definition];
  }));

  const operationVariants = [];
  const resultVariants = [];
  for (const command of commandIds) {
    const source = requireCommandSchema(schemas, command);
    const prefix = `batch_${safeName(command)}`;
    const family = `batch_${commandFamily(command)}`;
    const inputName = `${prefix}_input`;
    const resultName = `${prefix}_result`;
    inputDefinitions[inputName] = addNamespacedDefinitions(
      source.input, `${family}_input_def`, inputDefinitions, true, resultReferences
    ).schema;
    resultDefinitions[resultName] = addNamespacedDefinitions(
      source.result, `${family}_result_def`, resultDefinitions, false, resultReferences
    ).schema;
    operationVariants.push({
      type: 'object', title: command, additionalProperties: false,
      properties: {
        operationId: identifier('Operation ID'),
        command: { type: 'string', title: 'Command', const: command },
        parameters: localReference(inputName)
      },
      required: ['operationId', 'command', 'parameters']
    });
    resultVariants.push(localReference(resultName));
  }

  return {
    input: {
      type: 'object', title: 'Atomic command batch', additionalProperties: false,
      properties: {
        name: { ...identifier('Undo/history name'), maxLength: 128 },
        timeoutMs: { type: 'integer', title: 'Timeout (ms)', minimum: 100,
          maximum: 10_000, default: 5_000 },
        operations: { type: 'array', title: 'Operations', minItems: 1, maxItems: 64,
          items: { oneOf: operationVariants } }
      },
      required: ['name', 'operations'],
      $defs: inputDefinitions
    },
    result: {
      type: 'object', title: 'Atomic command batch result', additionalProperties: false,
      properties: {
        results: { type: 'array', minItems: 1, maxItems: 64, items: {
          type: 'object', additionalProperties: false,
          properties: {
            operationId: identifier('Operation ID'),
            value: { anyOf: resultVariants }
          },
          required: ['operationId', 'value']
        } }
      },
      required: ['results'],
      $defs: resultDefinitions
    }
  };
};
