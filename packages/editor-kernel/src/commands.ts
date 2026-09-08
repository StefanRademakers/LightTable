import type { DocumentAddress, TransactionId } from './identities';

export type CommandOrigin = 'ui' | 'action' | 'mcp' | 'replay';

export interface EditorCommand<
  Type extends string = string,
  Parameters = Readonly<Record<string, unknown>>,
> {
  readonly type: Type;
  readonly target: DocumentAddress;
  readonly parameters: Parameters;
  readonly origin: CommandOrigin;
  readonly transactionId: TransactionId;
}

export type CommandFailureCode =
  | 'cancelled'
  | 'capability-unavailable'
  | 'conflict'
  | 'invalid-parameters'
  | 'resource-failure'
  | 'stale-document'
  | 'unsupported';

export type CommandResult<Value = void> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly code: CommandFailureCode;
      readonly message: string;
      readonly recoverable: boolean;
    };

export interface CommandHandler<Command extends EditorCommand, Value = void> {
  execute(command: Command): Promise<CommandResult<Value>>;
}
