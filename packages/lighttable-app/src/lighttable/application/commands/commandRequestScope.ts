import {
  LIGHTTABLE_COMMAND_DEFINITIONS,
  type LightTableCommandId
} from '@lighttable/command-contract';

const commandScopes = new Map(
  LIGHTTABLE_COMMAND_DEFINITIONS.map(({ id, scope }) => [id, scope] as const)
);

export const commandScope = (command: LightTableCommandId): 'workspace' | 'document' => {
  const scope = commandScopes.get(command);
  if (!scope) throw new Error(`Unknown LightTable command scope: ${command}.`);
  return scope;
};

export const commandDocumentTarget = (
  command: LightTableCommandId,
  currentDocumentId: string
): { readonly documentId: string } | Record<string, never> => (
  commandScope(command) === 'document' ? { documentId: currentDocumentId } : {}
);
