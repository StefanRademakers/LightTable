import { Checkbox, Button, TextInput, NumberField } from '@lighttable/ui';
import React, { useEffect, useMemo, useState } from 'react';
import {
  formatSchemaValidationIssues,
  validateJsonSchemaValue,
  type LightTableJsonSchema
} from '@lighttable/command-contract';

import { Select } from '@lighttable/ui';


const record = (value: unknown): value is Readonly<Record<string, unknown>> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const resolveSchema = (schema: LightTableJsonSchema, root: LightTableJsonSchema) => {
  const match = schema.$ref?.match(/^#\/\$defs\/([^/]+)$/u);
  const referenced = match ? root.$defs?.[match[1]] : undefined;
  return referenced ? { ...referenced, ...schema, $ref: undefined } : schema;
};

const objectDefaults = (
  schema: LightTableJsonSchema,
  root: LightTableJsonSchema = schema
): Readonly<Record<string, unknown>> => {
  schema = resolveSchema(schema, root);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries: [string, unknown][] = Object.entries(properties).flatMap(([name, property]) => (
    required.has(name) ? [[name, initialFieldValue(property, root)]] : []
  ));
  if (entries.length === 0 && (schema.minProperties ?? 0) > 0) {
    const seeded = Object.entries(properties).find(([, property]) => property.default !== undefined
      || property.enum?.length || property.type === 'boolean');
    if (seeded) entries.push([seeded[0], initialFieldValue(seeded[1], root)]);
  }
  return Object.fromEntries(entries);
};

const initialFieldValue = (schema: LightTableJsonSchema, root: LightTableJsonSchema): unknown => {
  schema = resolveSchema(schema, root);
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (schema.oneOf?.length) return initialFieldValue(schema.oneOf[0], root);
  if (schema.type === 'object') return objectDefaults(schema, root);
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
  return '';
};

export const createCommandParameterDefaults = (
  schema: LightTableJsonSchema
): Readonly<Record<string, unknown>> => objectDefaults(schema);

interface SchemaFieldProps {
  readonly name: string;
  readonly schema: LightTableJsonSchema;
  readonly value: unknown;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
  readonly onRemove?: () => void;
  readonly rootSchema: LightTableJsonSchema;
}

const PrimitiveField: React.FC<Omit<SchemaFieldProps, 'required' | 'onRemove' | 'rootSchema'>> = ({
  name, schema, value, disabled, onChange
}) => {
  const label = schema.title ?? name;
  if (schema.const !== undefined) return <label>
    <span>{label}</span>
    <TextInput tabIndex={-1} value={String(schema.const)} disabled readOnly />
  </label>;
  if (schema.type === 'boolean') return <label className="is-checkbox">
    <Checkbox tabIndex={-1} checked={value === true}
      disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
    <span>{label}</span>
  </label>;
  if (schema.enum) return <label>
    <span>{label}</span>
    <Select value={String(value)} disabled={disabled}
      onValueChange={(nextValue) => onChange(nextValue)}>
      {schema.enum.map((option) => <option key={String(option)} value={String(option)}>
        {String(option)}
      </option>)}
    </Select>
  </label>;
  if (schema.type === 'array' && schema.items?.type === 'string') return <label>
    <span>{label}</span>
    <TextInput tabIndex={-1} value={Array.isArray(value) ? value.join(', ') : ''} disabled={disabled}
      placeholder="layer-id, layer-id"
      onChange={(event) => onChange(event.currentTarget.value.split(',')
        .map((item) => item.trim()).filter(Boolean))} />
  </label>;
  if (schema.type === 'number' || schema.type === 'integer') return <label>
    <span>{label}</span>
    <NumberField tabIndex={-1} updateMode="input" kind={schema.type === 'integer' ? 'integer' : 'float'} value={typeof value === 'number' ? value : null} disabled={disabled}
      min={schema.minimum} max={schema.maximum}
      step={schema['x-lighttable-step'] ?? (schema.type === 'integer' ? 1 : 'any')}
      onValueChange={onChange} onEmpty={() => onChange('')} />
  </label>;
  return <label>
    <span>{label}</span>
    <TextInput tabIndex={-1} value={typeof value === 'string' ? value : ''} disabled={disabled}
      minLength={schema.minLength} maxLength={schema.maxLength}
      onChange={(event) => onChange(event.currentTarget.value)} />
  </label>;
};

const SchemaField: React.FC<SchemaFieldProps> = ({
  name, schema, value, required, disabled, onChange, onRemove, rootSchema
}) => {
  const resolved = resolveSchema(schema, rootSchema);
  if (resolved !== schema) return <SchemaField name={name} schema={resolved} value={value}
    required={required} disabled={disabled} onChange={onChange} onRemove={onRemove}
    rootSchema={rootSchema} />;
  const label = schema.title ?? name;
  if (value === undefined) return <div className="lighttable-command-parameter-editor__optional">
    <span>{label}</span>
    <Button disabled={disabled}
      onClick={() => onChange(initialFieldValue(schema, rootSchema))}>Add</Button>
  </div>;

  if (schema.oneOf?.length) {
    const selected = Math.max(0, schema.oneOf.findIndex((branch) =>
      validateJsonSchemaValue({ ...branch, $defs: rootSchema.$defs }, value).valid));
    const branch = schema.oneOf[selected];
    return <fieldset>
      <legend>{label}</legend>
      {!required && onRemove ? <Button disabled={disabled}
        onClick={onRemove}>Remove</Button> : null}
      <label>
        <span>Variant</span>
        <Select value={String(selected)} disabled={disabled}
          onValueChange={(nextValue) => onChange(initialFieldValue(
            schema.oneOf![Number(nextValue)], rootSchema
          ))}>
          {schema.oneOf.map((option, index) => <option key={index} value={index}>
            {option.title ?? `Variant ${index + 1}`}
          </option>)}
        </Select>
      </label>
      <SchemaField name="Value" schema={branch} value={value} required disabled={disabled}
        onChange={onChange} rootSchema={rootSchema} />
    </fieldset>;
  }

  if (schema.type === 'array' && schema.items && schema.items.type !== 'string') {
    const items = Array.isArray(value) ? value : [];
    const minimum = schema.minItems ?? 0;
    const maximum = schema.maxItems ?? Number.MAX_SAFE_INTEGER;
    return <fieldset>
      <legend>{label}</legend>
      {!required && onRemove ? <Button disabled={disabled}
        onClick={onRemove}>Remove</Button> : null}
      {items.map((item, index) => <div
        className="lighttable-command-parameter-editor__array-item" key={index}>
        <SchemaField name={`${label} ${index + 1}`} schema={schema.items!} value={item}
          required disabled={disabled} rootSchema={rootSchema}
          onChange={(next) => onChange(items.map((current, itemIndex) => (
            itemIndex === index ? next : current
          )))} />
        <Button disabled={disabled || items.length <= minimum}
          onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>
          Remove item
        </Button>
      </div>)}
      <Button disabled={disabled || items.length >= maximum}
        onClick={() => onChange([...items, initialFieldValue(schema.items!, rootSchema)])}>
        Add item
      </Button>
    </fieldset>;
  }

  if (schema.type === 'object') {
    const current = record(value) ? value : {};
    const requiredProperties = new Set(schema.required ?? []);
    return <fieldset>
      <legend>{label}</legend>
      {!required && onRemove ? <Button disabled={disabled}
        onClick={onRemove}>Remove</Button> : null}
      {Object.entries(schema.properties ?? {}).map(([childName, childSchema]) => (
        <SchemaField key={childName} name={childName} schema={childSchema}
          value={current[childName]} required={requiredProperties.has(childName)} disabled={disabled}
          rootSchema={rootSchema}
          onChange={(next) => onChange({ ...current, [childName]: next })}
          onRemove={() => onChange(Object.fromEntries(
            Object.entries(current).filter(([key]) => key !== childName)
          ))} />
      ))}
    </fieldset>;
  }

  return <div className="lighttable-command-parameter-editor__field">
    <PrimitiveField name={name} schema={schema} value={value} disabled={disabled} onChange={onChange} />
    {!required && onRemove ? <Button disabled={disabled}
      onClick={onRemove}>Remove</Button> : null}
  </div>;
};

interface CommandParameterEditorProps {
  readonly schema: LightTableJsonSchema;
  readonly initialParameters?: Readonly<Record<string, unknown>>;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onRun: (parameters: Readonly<Record<string, unknown>>) => void;
  readonly runLabel?: string;
}

export interface CommandParameterFieldsProps {
  readonly schema: LightTableJsonSchema;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly disabled: boolean;
  readonly onChange: (parameters: Readonly<Record<string, unknown>>) => void;
}

export const CommandParameterFields: React.FC<CommandParameterFieldsProps> = ({
  schema, parameters, disabled, onChange
}) => {
  const validation = useMemo(() => validateJsonSchemaValue(schema, parameters), [parameters, schema]);
  const required = new Set(schema.required ?? []);
  const update = (name: string, value: unknown) => onChange({ ...parameters, [name]: value });
  const remove = (name: string) => onChange(Object.fromEntries(
    Object.entries(parameters).filter(([key]) => key !== name)
  ));
  return <>
    {schema['x-lighttable-variant-editor'] === true ? <SchemaField name={schema.title ?? 'Parameters'} schema={schema}
      value={parameters} required disabled={disabled} onChange={(value) => {
        if (record(value)) onChange(value);
      }} rootSchema={schema} /> : Object.entries(schema.properties ?? {}).map(([name, property]) => (
      <SchemaField key={name} name={name} schema={property} value={parameters[name]}
        required={required.has(name)} disabled={disabled} onChange={(value) => update(name, value)}
        onRemove={() => remove(name)} rootSchema={schema} />
    ))}
    {!validation.valid
      ? <p className="lighttable-command-parameter-editor__error">
          {formatSchemaValidationIssues(validation.issues)}
        </p>
      : null}
  </>;
};

export const CommandParameterEditor: React.FC<CommandParameterEditorProps> = ({
  schema,
  initialParameters,
  disabled,
  running,
  onRun,
  runLabel = 'Run'
}) => {
  const [parameters, setParameters] = useState(() => initialParameters
    ? structuredClone(initialParameters)
    : createCommandParameterDefaults(schema));
  useEffect(() => {
    setParameters(initialParameters ? structuredClone(initialParameters) : createCommandParameterDefaults(schema));
  }, [initialParameters, schema]);
  const validation = useMemo(() => validateJsonSchemaValue(schema, parameters), [parameters, schema]);

  return <div className="lighttable-command-parameter-editor">
    <CommandParameterFields schema={schema} parameters={parameters} disabled={disabled}
      onChange={setParameters} />
    <Button disabled={disabled || !validation.valid}
      onClick={() => onRun(parameters)}>
      {running ? 'Running…' : runLabel}
    </Button>
  </div>;
};
