const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const issue = (path, code, message) => ({ path, code, message });

const referenced = (schema, root) => {
  if (!schema.$ref) return schema;
  const match = schema.$ref.match(/^#\/\$defs\/([^/]+)$/u);
  return match ? root.$defs?.[match[1]] ?? schema : schema;
};

const matches = (schema, value, root) => {
  const issues = [];
  validateNode(schema, value, [], issues, root);
  return issues.length === 0;
};

const validateNode = (schema, value, path, issues, root) => {
  const resolved = referenced(schema, root);
  if (resolved !== schema) return validateNode(resolved, value, path, issues, root);
  if (schema.$ref) {
    issues.push(issue(path, 'ref', `uses an unresolved schema reference: ${schema.$ref}`));
    return;
  }
  if (schema.const !== undefined && !Object.is(schema.const, value)) {
    issues.push(issue(path, 'const', `must equal ${String(schema.const)}`));
  }
  if (schema.allOf) schema.allOf.forEach((branch) => validateNode(branch, value, path, issues, root));
  if (schema.anyOf && !schema.anyOf.some((branch) => matches(branch, value, root))) {
    issues.push(issue(path, 'any-of', 'must match at least one supported variant'));
  }
  if (schema.oneOf) {
    const count = schema.oneOf.filter((branch) => matches(branch, value, root)).length;
    if (count !== 1) issues.push(issue(path, 'one-of', 'must match exactly one supported variant'));
  }
  if (schema.not && matches(schema.not, value, root)) {
    issues.push(issue(path, 'not', 'uses a property combination that is not supported'));
  }
  if (schema.if) {
    const branch = matches(schema.if, value, root) ? schema.then : schema.else;
    if (branch) validateNode(branch, value, path, issues, root);
  }
  if (schema.type === 'object') {
    if (!record(value)) {
      issues.push(issue(path, 'type', 'must be an object'));
      return;
    }
    const properties = schema.properties ?? {};
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      issues.push(issue(path, 'min-properties', `must contain at least ${schema.minProperties} propert${schema.minProperties === 1 ? 'y' : 'ies'}`));
    }
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
      issues.push(issue(path, 'max-properties', `must contain at most ${schema.maxProperties} properties`));
    }
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        issues.push(issue([...path, required], 'required', 'is required'));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          issues.push(issue([...path, key], 'additional-property', 'is not a supported property'));
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateNode(childSchema, value[key], [...path, key], issues, root);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      issues.push(issue(path, 'type', 'must be an array'));
      return;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push(issue(path, 'min-items', `must contain at least ${schema.minItems} item(s)`));
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push(issue(path, 'max-items', `must contain at most ${schema.maxItems} item(s)`));
    }
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      issues.push(issue(path, 'unique-items', 'must not contain duplicate items'));
    }
    if (schema.items) value.forEach((item, index) => validateNode(schema.items, item, [...path, index], issues, root));
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      issues.push(issue(path, 'type', 'must be a string'));
      return;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push(issue(path, 'min-length', `must contain at least ${schema.minLength} character(s)`));
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push(issue(path, 'max-length', `must contain at most ${schema.maxLength} character(s)`));
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern, 'u')).test(value)) {
      issues.push(issue(path, 'pattern', 'has an invalid format'));
    }
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(issue(path, 'type', 'must be a finite number'));
      return;
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(issue(path, 'minimum', `must be at least ${schema.minimum}`));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(issue(path, 'maximum', `must be at most ${schema.maximum}`));
    }
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) {
      issues.push(issue(path, 'type', 'must be a safe integer'));
      return;
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(issue(path, 'minimum', `must be at least ${schema.minimum}`));
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(issue(path, 'maximum', `must be at most ${schema.maximum}`));
    }
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    issues.push(issue(path, 'type', 'must be a boolean'));
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(issue(path, 'enum', `must be one of: ${schema.enum.join(', ')}`));
  }
};

export const validateJsonSchemaValue = (schema, value) => {
  const issues = [];
  validateNode(schema, value, [], issues, schema);
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
};

export const formatSchemaValidationIssues = (issues) => issues.map(({ path, message }) => (
  `${path.length > 0 ? path.join('.') : 'parameters'} ${message}`
)).join('; ');
