import { useLayoutEffect, useMemo, useRef } from 'react';
import { TextCreationInteraction, type TextCreationPorts } from '../../application/text/TextCreationInteraction';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION, type LightTableCommandService } from '../../application/commands/lightTableCommandService';

interface TextCreationSubmission {
  readonly commands: Pick<LightTableCommandService, 'enqueueTextCreation'>;
  readonly documentId: string;
  nextRequestId(): string;
}

export const useTextCreation = (identity: object | string, tool: string, generation: number,
  registry: object, ports: Omit<TextCreationPorts, 'enqueue'>, submission: TextCreationSubmission) => {
  // Each intent keeps this render's submission binding, not a later active document/service.
  const boundPorts: TextCreationPorts = { ...ports, enqueue: (parameters, assertCurrent) => submission.commands.enqueueTextCreation({
    protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION, requestId: submission.nextRequestId(),
    command: 'text.create', documentId: submission.documentId, parameters
  }, assertCurrent) };
  const latest = useRef(boundPorts); latest.current = boundPorts;
  const controller = useMemo(() => new TextCreationInteraction(() => latest.current), []);
  useLayoutEffect(() => () => { controller.cancel(); }, [controller, identity, tool, generation, registry]);
  return controller;
};
