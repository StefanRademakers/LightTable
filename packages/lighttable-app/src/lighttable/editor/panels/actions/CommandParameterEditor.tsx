import React, { useMemo, useState } from 'react';
import {
  formatSchemaValidationIssues,
  validateJsonSchemaValue,
  type LightTableJsonSchema
} from '@lighttable/command-contract';
import { FormInput } from '../../../../ui/FormInput';
import { FormSelect } from '../../../../ui/FormSelect';
import { ActionButton } from '../../../../ui/ActionButton';

const record = (value: unknown): value is Readonly<Record<string, unknown>> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const objectDefaults = (schema: LightTableJsonSchema): Readonly<Record<string, unknown>> => {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries: [string, unknown][] = Object.entries(properties).flatMap(([name, property]) => (
    required.has(name) ? [[name, initialFieldValue(property)]] : []
  ));
  if (entries.length === 0 && (schema.minProperties ?? 0) > 0) {
    const seeded = Object.entries(properties).find(([, property]) => property.default !== undefined
      || property.enum?.length || property.type === 'boolean');
    if (seeded) entries.push([seeded[0], initialFieldValue(seeded[1])]);
  }
  return Object.fromEntries(entries);
};

const initialFieldValue = (schema: LightTableJsonSchema): unknown => {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.oneOf?.length) return initialFieldValue(schema.oneOf[0]);
  if (schema.type === 'object') return objectDefaults(schema);
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
}

const PrimitiveField: React.FC<Omit<SchemaFieldProps, 'required' | 'onRemove'>> = ({
  name, schema, value, disabled, onChange
}) => {
  const label = schema.title ?? name;
  if (schema.type === 'boolean') return <label className="is-checkbox">
    <FormInput type="checkbox" checked={value === true}
      disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} />
    <span>{label}</span>
  </label>;
  if (schema.enum) return <label>
    <span>{label}</span>
    <FormSelect value={String(value)} disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}>
      {schema.enum.map((option) => <option key={String(option)} value={String(option)}>
        {String(option)}
      </option>)}
    </FormSelect>
  </label>;
  if (schema.type === 'array' && schema.items?.type === 'string') return <label>
    <span>{label}</span>
    <FormInput value={Array.isArray(value) ? value.join(', ') : ''} disabled={disabled}
      placeholder="layer-id, layer-id"
      onChange={(event) => onChange(event.currentTarget.value.split(',')
        .map((item) => item.trim()).filter(Boolean))} />
  </label>;
  if (schema.type === 'number' || schema.type === 'integer') return <label>
    <span>{label}</span>
    <FormInput type="number" value={typeof value === 'number' ? String(value) : ''} disabled={disabled}
      min={schema.minimum} max={schema.maximum}
      step={schema['x-lighttable-step'] ?? (schema.type === 'integer' ? 1 : 'any')}
      onChange={(event) => onChange(event.currentTarget.value === ''
        ? '' : Number(event.currentTarget.value))} />
  </label>;
  return <label>
    <span>{label}</span>
    <FormInput value={typeof value === 'string' ? value : ''} disabled={disabled}
      minLength={schema.minLength} maxLength={schema.maxLength}
      onChange={(event) => onChange(event.currentTarget.value)} />
  </label>;
};

const SchemaField: React.FC<SchemaFieldProps> = ({
  name, schema, value, required, disabled, onChange, onRemove
}) => {
  const label = schema.title ?? name;
  if (value === undefined) return <div className="lighttable-command-parameter-editor__optional">
    <span>{label}</span>
    <ActionButton size="control" disabled={disabled}
      onClick={() => onChange(initialFieldValue(schema))}>Add</ActionButton>
  </div>;

  if (schema.oneOf?.length) {
    const selected = Math.max(0, schema.oneOf.findIndex((branch) =>
      validateJsonSchemaValue(branch, value).valid));
    const branch = schema.oneOf[selected];
    return <fieldset>
      <legend>{label}</legend>
      {!required && onRemove ? <ActionButton size="control" disabled={disabled}
        onClick={onRemove}>Remove</ActionButton> : null}
      <label>
        <span>Variant</span>
        <FormSelect value={String(selected)} disabled={disabled}
          onChange={(event) => onChange(initialFieldValue(schema.oneOf![Number(event.currentTarget.value)]))}>
          {schema.oneOf.map((option, index) => <option key={index} value={index}>
            {option.title ?? `Variant ${index + 1}`}
          </option>)}
        </FormSelect>
      </label>
      <SchemaField name="Value" schema={branch} value={value} required disabled={disabled}
        onChange={onChange} />
    </fieldset>;
  }

  if (schema.type === 'object') {
    const current = record(value) ? value : {};
    const requiredProperties = new Set(schema.required ?? []);
    return <fieldset>
      <legend>{label}</legend>
      {!required && onRemove ? <ActionButton size="control" disabled={disabled}
        onClick={onRemove}>Remove</ActionButton> : null}
      {Object.entries(schema.properties ?? {}).map(([childName, childSchema]) => (
        <SchemaField key={childName} name={childName} schema={childSchema}
          value={current[childName]} required={requiredProperties.has(childName)} disabled={disabled}
          onChange={(next) => onChange({ ...current, [childName]: next })}
          onRemove={() => onChange(Object.fromEntries(
            Object.entries(current).filter(([key]) => key !== childName)
          ))} />
      ))}
    </fieldset>;
  }

  return <div className="lighttable-command-parameter-editor__field">
    <PrimitiveField name={name} schema={schema} value={value} disabled={disabled} onChange={onChange} />
    {!required && onRemove ? <ActionButton size="control" disabled={disabled}
      onClick={onRemove}>Remove</ActionButton> : null}
  </div>;
};

interface CommandParameterEditorProps {
  readonly schema: LightTableJsonSchema;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onRun: (parameters: Readonly<Record<string, unknown>>) => void;
}

export const CommandParameterEditor: React.FC<CommandParameterEditorProps> = ({
  schema,
  disabled,
  running,
  onRun
}) => {
  const [parameters, setParameters] = useState(() => createCommandParameterDefaults(schema));
  const validation = useMemo(() => validateJsonSchemaValue(schema, parameters), [parameters, schema]);
  const required = new Set(schema.required ?? []);
  const update = (name: string, value: unknown) => setParameters((current) => ({ ...current, [name]: value }));
  const remove = (name: string) => setParameters((current) => Object.fromEntries(
    Object.entries(current).filter(([key]) => key !== name)
  ));

  return <div className="lighttable-command-parameter-editor">
    {Object.entries(schema.properties ?? {}).map(([name, property]) => (
      <SchemaField key={name} name={name} schema={property} value={parameters[name]}
        required={required.has(name)} disabled={disabled} onChange={(value) => update(name, value)}
        onRemove={() => remove(name)} />
    ))}
    {!validation.valid
      ? <p className="lighttable-command-parameter-editor__error">
          {formatSchemaValidationIssues(validation.issues)}
        </p>
      : null}
    <ActionButton size="control" disabled={disabled || !validation.valid}
      onClick={() => onRun(parameters)}>
      {running ? 'Running…' : 'Run'}
    </ActionButton>
  </div>;
};
