import type { LightTableCommandId } from './lightTableCommandContract';

export const MAX_BATCH_OPERATIONS = 64;
export const MAX_BATCH_BYTES = 256 * 1024;
export const MAX_BATCH_DURATION_MS = 10_000;

export const ATOMIC_BATCH_COMMANDS = [
  'layer.rename', 'layer.setVisibility', 'layer.setFillOpacity',
  'layer.move', 'layer.setBlendMode', 'layer.setClipping', 'layer.setLock',
  'layer.style.setEnabled', 'layer.effect.setEnabled',
  'text.create', 'text.replaceRange', 'text.format', 'text.setLayout',
  'vector.create', 'vector.update', 'vector.remove',
  'layer.effect.add', 'layer.effect.update', 'layer.effect.remove', 'layer.effect.move'
] as const satisfies readonly LightTableCommandId[];

export type AtomicBatchCommandId = typeof ATOMIC_BATCH_COMMANDS[number];
export interface AtomicBatchOperation {
  readonly operationId: string;
  readonly command: AtomicBatchCommandId;
  readonly parameters: unknown;
}
export interface AtomicCommandBatch {
  readonly name: string;
  readonly timeoutMs: number;
  readonly operations: readonly AtomicBatchOperation[];
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const boundedText = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
);

export const parseAtomicCommandBatch = (value: unknown): AtomicCommandBatch | null => {
  if (!record(value) || !boundedText(value.name, 128) || !Array.isArray(value.operations)
    || value.operations.length < 1 || value.operations.length > MAX_BATCH_OPERATIONS) return null;
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return null; }
  if (bytes > MAX_BATCH_BYTES) return null;
  const allowed = new Set<string>(ATOMIC_BATCH_COMMANDS);
  const operationIds = new Set<string>();
  const operations: AtomicBatchOperation[] = [];
  for (const candidate of value.operations) {
    if (!record(candidate) || !boundedText(candidate.operationId, 128)
      || !allowed.has(String(candidate.command)) || operationIds.has(candidate.operationId)) return null;
    operationIds.add(candidate.operationId);
    operations.push({ operationId: candidate.operationId,
      command: candidate.command as AtomicBatchCommandId, parameters: candidate.parameters });
  }
  const timeoutMs = value.timeoutMs === undefined ? 5_000 : Number(value.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_BATCH_DURATION_MS) return null;
  return { name: value.name.trim(), timeoutMs, operations };
};
