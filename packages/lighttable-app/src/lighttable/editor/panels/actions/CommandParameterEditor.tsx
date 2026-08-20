import React, { useMemo, useState } from 'react';
import {
  formatSchemaValidationIssues,
  validateJsonSchemaValue,
  type LightTableJsonSchema
} from '@lighttable/command-contract';
import { FormInput } from '../../../../ui/FormInput';
import { FormSelect } from '../../../../ui/FormSelect';
import { ActionButton } from '../../../../ui/ActionButton';

const initialFieldValue = (schema: LightTableJsonSchema): unknown => {
  if (schema.default !== undefined) return schema.default;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
  return '';
};

export const createCommandParameterDefaults = (
  schema: LightTableJsonSchema
): Readonly<Record<string, unknown>> => Object.fromEntries(
  Object.entries(schema.properties ?? {}).map(([name, property]) => [name, initialFieldValue(property)])
);

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
  const update = (name: string, value: unknown) => setParameters((current) => ({ ...current, [name]: value }));

  return <div className="lighttable-command-parameter-editor">
    {Object.entries(schema.properties ?? {}).map(([name, property]) => {
      const label = property.title ?? name;
      const value = parameters[name];
      if (property.type === 'boolean') return <label key={name} className="is-checkbox">
        <FormInput type="checkbox" checked={value === true}
          disabled={disabled} onChange={(event) => update(name, event.currentTarget.checked)} />
        <span>{label}</span>
      </label>;
      if (property.enum) return <label key={name}>
        <span>{label}</span>
        <FormSelect value={String(value)} disabled={disabled}
          onChange={(event) => update(name, event.currentTarget.value)}>
          {property.enum.map((option) => <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>)}
        </FormSelect>
      </label>;
      if (property.type === 'array' && property.items?.type === 'string') return <label key={name}>
        <span>{label}</span>
        <FormInput value={(value as readonly string[]).join(', ')} disabled={disabled}
          placeholder="layer-id, layer-id"
          onChange={(event) => update(name, event.currentTarget.value.split(',')
            .map((item) => item.trim()).filter(Boolean))} />
      </label>;
      if (property.type === 'number' || property.type === 'integer') return <label key={name}>
        <span>{label}</span>
        <FormInput type="number" value={typeof value === 'number' ? String(value) : ''} disabled={disabled}
          min={property.minimum} max={property.maximum}
          step={property['x-lighttable-step'] ?? (property.type === 'integer' ? 1 : 'any')}
          onChange={(event) => update(name, event.currentTarget.value === ''
            ? '' : Number(event.currentTarget.value))} />
      </label>;
      return <label key={name}>
        <span>{label}</span>
        <FormInput value={String(value)} disabled={disabled}
          minLength={property.minLength} maxLength={property.maxLength}
          onChange={(event) => update(name, event.currentTarget.value)} />
      </label>;
    })}
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
