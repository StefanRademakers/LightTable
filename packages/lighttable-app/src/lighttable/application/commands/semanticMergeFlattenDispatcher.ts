import { getFlattenGroupPlan, getFlattenImagePlan, getMergeLayersPlan } from '../../editor/document/documentCommands';
import type { ImageDocument } from '../../editor/document/documentTypes';
import {
  parseSemanticFlattenGroupCommand,
  parseSemanticFlattenImageCommand,
  parseSemanticLayerMergeCommand,
  type SemanticFlattenGroupCommand,
  type SemanticLayerMergeCommand
} from './semanticMergeFlattenCommandContract';

type Result = { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: 'invalid-parameters' | 'command-unavailable' | 'execution-failed'; readonly message: string };
type Executor<T> = ((command: T) => unknown | Promise<unknown>) | undefined;

const executeChanged = async <T>(command: T, execute: Executor<T>, unavailable: string,
  document: ImageDocument, revision: () => number | undefined): Promise<Result> => {
  if (!execute) return { ok: false, code: 'command-unavailable', message: unavailable };
  const value = await execute(command);
  if (!value || revision() === document.revision) {
    return { ok: false, code: 'execution-failed', message: 'The destructive layer operation did not complete.' };
  }
  return { ok: true, value };
};

export const dispatchSemanticLayerMerge = async (value: unknown, document: ImageDocument,
  execute: Executor<SemanticLayerMergeCommand>, revision: () => number | undefined): Promise<Result> => {
  const command = parseSemanticLayerMergeCommand(value);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  const plan = getMergeLayersPlan(document, command.layerIds);
  if (!plan) return { ok: false, code: 'command-unavailable',
    message: 'Merge requires at least two contiguous sibling layers.' };
  return executeChanged({ layerIds: plan.layerIds }, execute,
    'Layer merge is unavailable in this host.', document, revision);
};

export const dispatchSemanticFlattenGroup = async (value: unknown, document: ImageDocument,
  execute: Executor<SemanticFlattenGroupCommand>, revision: () => number | undefined): Promise<Result> => {
  const command = parseSemanticFlattenGroupCommand(value);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  if (!getFlattenGroupPlan(document, command.groupId)) return { ok: false, code: 'command-unavailable',
    message: 'The target must be a non-empty group.' };
  return executeChanged(command, execute, 'Group flatten is unavailable in this host.', document, revision);
};

export const dispatchSemanticFlattenImage = async (value: unknown, document: ImageDocument,
  execute: Executor<Record<string, never>>, revision: () => number | undefined): Promise<Result> => {
  const command = parseSemanticFlattenImageCommand(value);
  if ('message' in command) return { ok: false, code: 'invalid-parameters', message: command.message };
  if (!getFlattenImagePlan(document)) return { ok: false, code: 'command-unavailable',
    message: 'The image has no layers to flatten.' };
  return executeChanged(command, execute, 'Image flatten is unavailable in this host.', document, revision);
};

export const dispatchSemanticMergeFlatten = (
  command: 'layer.merge' | 'layer.flattenGroup' | 'document.flattenImage',
  value: unknown,
  document: ImageDocument,
  executors: {
    readonly merge: Executor<SemanticLayerMergeCommand>;
    readonly flattenGroup: Executor<SemanticFlattenGroupCommand>;
    readonly flattenImage: Executor<Record<string, never>>;
  },
  revision: () => number | undefined
) => command === 'layer.merge'
  ? dispatchSemanticLayerMerge(value, document, executors.merge, revision)
  : command === 'layer.flattenGroup'
    ? dispatchSemanticFlattenGroup(value, document, executors.flattenGroup, revision)
    : dispatchSemanticFlattenImage(value, document, executors.flattenImage, revision);
