import type { GenAiWorkflowValidationIssue } from '@lighttable/genai-core';

export type GenAiGenerationReadinessCode =
  | 'ready'
  | 'service-unavailable'
  | 'project-required'
  | 'workflow-loading'
  | 'prompt-required'
  | 'invalid-fields'
  | 'missing-mentions'
  | 'too-many-references'
  | 'reference-unsupported'
  | 'generating';

export type GenAiGenerationReadiness =
  | { readonly code: 'ready'; readonly ready: true }
  | {
    readonly code: Exclude<GenAiGenerationReadinessCode, 'ready'>;
    readonly ready: false;
    readonly message: string;
  };

export const resolveGenAiGenerationReadiness = ({
  serviceAvailable,
  projectId,
  workflowReady,
  prompt,
  validationIssues,
  missingMentionCount,
  tooManyReferences,
  referenceIssue,
  generating
}: {
  readonly serviceAvailable: boolean;
  readonly projectId?: string;
  readonly workflowReady: boolean;
  readonly prompt: string;
  readonly validationIssues: readonly GenAiWorkflowValidationIssue[];
  readonly missingMentionCount: number;
  readonly tooManyReferences: boolean;
  readonly referenceIssue?: string;
  readonly generating: boolean;
}): GenAiGenerationReadiness => {
  if (!serviceAvailable) return {
    code: 'service-unavailable', ready: false,
    message: 'Generation is unavailable in this host.'
  };
  if (!projectId) return {
    code: 'project-required', ready: false,
    message: 'Open a project before generating.'
  };
  if (!workflowReady) return {
    code: 'workflow-loading', ready: false,
    message: 'The selected workflow is still loading.'
  };
  if (!prompt.trim()) return {
    code: 'prompt-required', ready: false,
    message: 'Enter a prompt before generating.'
  };
  if (validationIssues.length) return {
    code: 'invalid-fields', ready: false,
    message: validationIssues[0]!.message
  };
  if (missingMentionCount) return {
    code: 'missing-mentions', ready: false,
    message: 'Remove or reconnect missing asset mentions.'
  };
  if (tooManyReferences) return {
    code: 'too-many-references', ready: false,
    message: 'Remove references until the selected model limit is met.'
  };
  if (referenceIssue) return {
    code: 'reference-unsupported', ready: false,
    message: referenceIssue
  };
  if (generating) return {
    code: 'generating', ready: false,
    message: 'Generation is already in progress.'
  };
  return { code: 'ready', ready: true };
};
