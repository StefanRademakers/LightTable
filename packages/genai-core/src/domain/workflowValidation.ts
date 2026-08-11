import type { GenAiWorkflowDefinition } from './contracts';

export interface GenAiWorkflowValidationIssue {
  readonly field: string;
  readonly message: string;
}

export const validateGenAiWorkflowValues = (
  workflow: GenAiWorkflowDefinition,
  values: Readonly<Record<string, unknown>>
): readonly GenAiWorkflowValidationIssue[] => workflow.fields.flatMap((field) => {
  const value = values[field.key];
  if (field.required && (
    value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  )) {
    return [{ field: field.key, message: `${field.label} is required.` }];
  }
  if (value === undefined || value === null || value === '') return [];
  if (field.kind === 'number' || field.kind === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return [{ field: field.key, message: `${field.label} must be a number.` }];
    }
    if (field.kind === 'integer' && !Number.isInteger(value)) {
      return [{ field: field.key, message: `${field.label} must be a whole number.` }];
    }
    if (field.minimum !== undefined && value < field.minimum) {
      return [{ field: field.key, message: `${field.label} must be at least ${field.minimum}.` }];
    }
    if (field.maximum !== undefined && value > field.maximum) {
      return [{ field: field.key, message: `${field.label} must be at most ${field.maximum}.` }];
    }
  }
  if (field.kind === 'enum' && !field.options?.some((option) => option.value === value)) {
    return [{ field: field.key, message: `${field.label} has an unsupported value.` }];
  }
  return [];
});
