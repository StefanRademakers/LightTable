import {
  LIGHTTABLE_AI_PROTOCOL_NAME,
  LIGHTTABLE_AI_PROTOCOL_VERSION,
  type LocalAiCapabilitiesV1,
  type LocalAiHealthV1,
  type LocalAiImageJobRequestV1,
  type LocalAiJobResultV1,
  type LocalAiJobStatusV1,
  type LocalAiOperation
} from './protocol';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const operation = (value: unknown): value is LocalAiOperation => value === 'image.create'
  || value === 'image.edit' || value === 'image.inpaint';
const fail = (message: string): never => { throw new Error(`Invalid LightTable AI Provider response: ${message}`); };

export const parseLocalAiHealth = (value: unknown): LocalAiHealthV1 => {
  if (!record(value) || !string(value.status) || value.protocolVersion !== LIGHTTABLE_AI_PROTOCOL_VERSION
    || !string(value.providerVersion) || typeof value.modelLoaded !== 'boolean') fail('health payload');
  return value as unknown as LocalAiHealthV1;
};

export const parseLocalAiCapabilities = (value: unknown): LocalAiCapabilitiesV1 => {
  if (!record(value) || !record(value.protocol) || value.protocol.name !== LIGHTTABLE_AI_PROTOCOL_NAME
    || value.protocol.version !== LIGHTTABLE_AI_PROTOCOL_VERSION || !record(value.provider)
    || !string(value.provider.id) || !string(value.provider.name) || !string(value.provider.version)
    || !Array.isArray(value.operations) || !value.operations.every(operation)
    || !record(value.input) || !record(value.output) || !record(value.limits)
    || !Array.isArray(value.models)) fail('capabilities payload');
  const payload = value as Record<string, unknown>;
  for (const model of payload.models as unknown[]) {
    if (!record(model) || !string(model.id) || !string(model.name) || !Array.isArray(model.operations)
      || !model.operations.every(operation)) fail('model capability');
  }
  return value as unknown as LocalAiCapabilitiesV1;
};

export const parseLocalAiJobStatus = (value: unknown): LocalAiJobStatusV1 => {
  if (!record(value) || !string(value.jobId) || !['queued', 'loading-model', 'running', 'completed', 'cancelled', 'failed'].includes(String(value.status))) {
    fail('job status');
  }
  return value as unknown as LocalAiJobStatusV1;
};

export const parseLocalAiJobResult = (value: unknown): LocalAiJobResultV1 => {
  if (!record(value) || !string(value.jobId) || !Array.isArray(value.images) || !record(value.generation)) fail('job result');
  const payload = value as Record<string, unknown>;
  for (const image of payload.images as unknown[]) {
    if (!record(image) || !string(image.id) || !string(image.url) || !string(image.mimeType)
      || typeof image.width !== 'number' || typeof image.height !== 'number') fail('result image');
  }
  return value as unknown as LocalAiJobResultV1;
};

export const validateLocalAiRequest = (value: unknown): LocalAiImageJobRequestV1 => {
  if (!record(value) || !operation(value.operation) || !string(value.intent) || !string(value.modelId)
    || typeof value.prompt !== 'string' || !record(value.output)
    || !Number.isInteger(value.output.width) || !Number.isInteger(value.output.height)
    || !Number.isInteger(value.output.count) || !['image/png', 'image/webp'].includes(String(value.output.mimeType))) {
    throw new Error('Invalid LightTable AI job request.');
  }
  if (value.operation !== 'image.create' && !record(value.baseImage)) {
    throw new Error(`${value.operation} requires a base image.`);
  }
  return value as unknown as LocalAiImageJobRequestV1;
};
