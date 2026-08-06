/** Thin Playwright client for LightTable's typed automation boundary. */
export class LightTableAutomationClient {
  #sequence = 0;

  constructor(page, requestPrefix = 'playwright') {
    this.page = page;
    this.requestPrefix = requestPrefix;
  }

  async attach(timeout = 10_000) {
    await this.page.waitForFunction(() => Boolean(window.__lightTableAutomation), undefined, { timeout });
    return this;
  }

  queryWorkspace() {
    return this.page.evaluate(() => window.__lightTableAutomation?.queryWorkspace() ?? null);
  }

  queryDocument(documentId) {
    return this.page.evaluate((id) => window.__lightTableAutomation?.queryDocument(id) ?? null, documentId);
  }

  queryLayers(documentId) {
    return this.page.evaluate((id) => window.__lightTableAutomation?.queryLayers(id) ?? null, documentId);
  }

  queryLayerEffects(documentId, layerId) {
    return this.page.evaluate(({ documentId, layerId }) =>
      window.__lightTableAutomation?.queryLayerEffects(documentId, layerId) ?? null,
    { documentId, layerId });
  }

  queryRenderTelemetry(documentId) {
    return this.page.evaluate((id) =>
      window.__lightTableAutomation?.queryRenderTelemetry?.(id) ?? null,
    documentId);
  }

  resetRenderTelemetry(documentId) {
    return this.page.evaluate((id) =>
      window.__lightTableAutomation?.resetRenderTelemetry?.(id) ?? false,
    documentId);
  }

  queryTask(documentId, taskId) {
    return this.page.evaluate(({ documentId, taskId }) =>
      window.__lightTableAutomation?.queryTask(documentId, taskId) ?? null,
    { documentId, taskId });
  }

  async execute(documentId, command, parameters = {}, options = {}) {
    const result = await this.page.evaluate(async (request) =>
      window.__lightTableAutomation?.execute(request) ?? null, {
      protocolVersion: 1,
      requestId: `${this.requestPrefix}-${++this.#sequence}`,
      command,
      documentId,
      parameters,
      ...(options.expectedDocumentRevision === undefined
        ? {}
        : { expectedDocumentRevision: options.expectedDocumentRevision })
    });
    if (!result || (options.requireCompleted !== false && result.status !== 'completed')) {
      throw new Error(result?.message ?? `${command} did not complete.`);
    }
    return result;
  }

  executeWorkspace(command, parameters = {}, options = {}) {
    return this.execute(undefined, command, parameters, options);
  }

  registerInputArtifact(bytes, name, mediaType) {
    const encoded = Buffer.from(bytes).toString('base64');
    return this.page.evaluate(({ encoded, name, mediaType }) => {
      const binary = atob(encoded);
      const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const file = new File([data], name, { type: mediaType });
      return window.__lightTableAutomation?.registerInputArtifact(file) ?? null;
    }, { encoded, name, mediaType });
  }

  beginGesture(request) {
    return this.page.evaluate((value) => window.__lightTableAutomation?.beginGesture(value) ?? null, request);
  }

  updateGesture(gestureId, samples) {
    return this.page.evaluate(({ gestureId, samples }) =>
      window.__lightTableAutomation?.updateGesture(gestureId, samples) ?? null,
    { gestureId, samples });
  }

  finishGesture(gestureId, commit) {
    return this.page.evaluate(({ gestureId, commit }) =>
      window.__lightTableAutomation?.finishGesture(gestureId, commit) ?? null,
    { gestureId, commit });
  }

  async waitForTask(documentId, taskId, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let task = await this.queryTask(documentId, taskId);
    while (task?.status === 'running' && Date.now() < deadline) {
      await this.page.waitForTimeout(50);
      task = await this.queryTask(documentId, taskId);
    }
    if (task?.status !== 'completed') {
      throw new Error(`Task ${taskId} did not complete: ${JSON.stringify(task)}`);
    }
    return task;
  }
}

export const attachLightTableAutomation = async (page, requestPrefix) => (
  new LightTableAutomationClient(page, requestPrefix).attach()
);
