import type { GenAiFieldDefinition } from './contracts';

const labelFor = (key: string, title: unknown): string => typeof title === 'string' && title.trim()
  ? title.trim()
  : key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .replace(/^./, (value) => value.toUpperCase());

const record = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;

export const normalizeGenAiJsonSchema = (
  schemaValue: unknown,
  defaults: Readonly<Record<string, unknown>> = {}
): readonly GenAiFieldDefinition[] => {
  const schema = record(schemaValue);
  const properties = record(schema?.properties);
  const required = new Set(Array.isArray(schema?.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : []);
  if (!properties) return [];
  return Object.entries(properties).map(([key, raw]) => {
    const sourceSchema = record(raw) ?? {};
    const options = Array.isArray(sourceSchema.enum)
      ? sourceSchema.enum.filter((value): value is string => typeof value === 'string')
        .map((value) => ({ value, label: value }))
      : undefined;
    const declaredType = sourceSchema.type;
    const nullableTypes = Array.isArray(declaredType)
      ? declaredType.filter((value): value is string => typeof value === 'string' && value !== 'null')
      : [];
    const type = nullableTypes.length === 1 ? nullableTypes[0] : declaredType;
    const itemSchema = record(sourceSchema.items);
    const isReferenceArray = type === 'array' && (
      ['visualReferences', 'references', 'images', 'inputImages'].includes(key)
      || typeof itemSchema?.$ref === 'string'
    );
    const kind: GenAiFieldDefinition['kind'] = options?.length
      ? 'enum'
      : isReferenceArray
        ? 'asset'
      : type === 'string' || type === 'number' || type === 'integer' || type === 'boolean'
        ? type
        : 'unknown';
    return {
      key,
      label: labelFor(key, sourceSchema.title),
      kind,
      required: required.has(key),
      advanced: sourceSchema['x-lighttable-advanced'] === true,
      ...(typeof sourceSchema.description === 'string' ? { description: sourceSchema.description } : {}),
      ...((key in defaults || 'default' in sourceSchema)
        ? { defaultValue: key in defaults ? defaults[key] : sourceSchema.default }
        : {}),
      ...(typeof sourceSchema.minimum === 'number' ? { minimum: sourceSchema.minimum } : {}),
      ...(typeof sourceSchema.maximum === 'number' ? { maximum: sourceSchema.maximum } : {}),
      ...(typeof sourceSchema.multipleOf === 'number' ? { step: sourceSchema.multipleOf } : {}),
      ...(options ? { options } : {}),
      sourceSchema
    };
  });
};
