import {
  isLightTableAgentAccessCommandId,
  type DocumentSessionId,
  type LightTableAutomationDriver
} from '@lighttable/app';

/**
 * Renderer-owned boundary for authenticated Agent Access requests.
 *
 * Transport authentication and scopes live in Electron main/the remote MCP
 * service. This boundary still enforces the product-owned semantic command
 * profile before a request reaches the full internal automation driver.
 */
export const invokeAgentDriver = async (
  driver: LightTableAutomationDriver,
  method: string,
  parameters: unknown
): Promise<unknown> => {
  const value = parameters as Record<string, unknown>;
  const documentId = String(value.documentId) as DocumentSessionId;
  const layerId = String(value.layerId) as Parameters<LightTableAutomationDriver['queryText']>[1];
  if (method === 'workspace.query') return driver.queryWorkspace();
  if (method === 'document.query') return driver.queryDocument(documentId);
  if (method === 'layer.list') return driver.queryLayers(documentId);
  if (method === 'layer.effects') return driver.queryLayerEffects(documentId, layerId);
  if (method === 'text.query') return driver.queryText(documentId, layerId);
  if (method === 'vector.query') return driver.queryVector(documentId, layerId);
  if (method === 'grade.queryBasic') return driver.queryBasicGrade(documentId, value.target);
  if (method === 'command.capabilities') {
    return driver.queryCapabilities(documentId)?.filter(({ command }) => (
      isLightTableAgentAccessCommandId(command)
    )) ?? null;
  }
  if (method === 'task.query') return driver.queryTask(documentId, String(value.taskId));
  if (method === 'task.events') {
    return driver.queryTaskEvents(value.afterCursor as number | undefined, value.limit as number | undefined);
  }
  if (method === 'artifact.list') return driver.listArtifacts();
  if (method === 'artifact.query') return driver.queryArtifact(String(value.artifactId));
  if (method === 'artifact.release') return driver.releaseArtifact(String(value.artifactId));
  if (method === 'artifact.register') {
    if (!(value.bytes instanceof Uint8Array)) throw new Error('Invalid agent artifact bytes.');
    return driver.registerInputArtifact(new File(
      [Uint8Array.from(value.bytes).buffer], String(value.name), { type: String(value.mediaType) }
    ));
  }
  if (method === 'artifact.resolve') {
    const file = driver.resolveArtifact(String(value.artifactId));
    return file ? {
      bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, mediaType: file.type
    } : null;
  }
  if (method === 'gesture.begin') return driver.beginGesture(value);
  if (method === 'gesture.update') return driver.updateGesture(String(value.gestureId), value.samples);
  if (method === 'gesture.finish') return driver.finishGesture(String(value.gestureId), value.commit === true);
  if (method === 'command.execute') {
    if (!isLightTableAgentAccessCommandId(value.command)) {
      throw new Error('This command is not exposed through Agent Access.');
    }
    return driver.execute({
      protocolVersion: 1, requestId: value.commandRequestId,
      command: value.command, documentId: value.documentId,
      parameters: value.commandParameters ?? {},
      ...(value.expectedDocumentRevision === undefined ? {}
        : { expectedDocumentRevision: value.expectedDocumentRevision })
    });
  }
  throw new Error(`Unsupported Agent Access method: ${method}`);
};
