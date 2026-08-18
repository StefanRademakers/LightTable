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

  queryText(documentId, layerId) {
    return this.page.evaluate(({ documentId, layerId }) =>
      window.__lightTableAutomation?.queryText(documentId, layerId) ?? null,
    { documentId, layerId });
  }

  queryVector(documentId, layerId) {
    return this.page.evaluate(({ documentId, layerId }) => (
      window.__lightTableAutomation?.queryVector(documentId, layerId) ?? null
    ), { documentId, layerId });
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

  queryTaskEvents(afterCursor = 0, limit = 100) {
    return this.page.evaluate(({ afterCursor, limit }) => (
      window.__lightTableAutomation?.queryTaskEvents(afterCursor, limit) ?? null
    ), { afterCursor, limit });
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

  async readArtifact(artifactId) {
    const artifact = await this.page.evaluate(async (id) => {
      const file = window.__lightTableAutomation?.resolveArtifact(id);
      if (!file) return null;
      return {
        name: file.name,
        mediaType: file.type,
        bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
      };
    }, artifactId);
    return artifact ? { ...artifact, bytes: Buffer.from(artifact.bytes) } : null;
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

  async waitForDocument(documentId, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let document = await this.queryDocument(documentId);
    while (document?.lifecycle !== 'ready' && Date.now() < deadline) {
      if (document?.lifecycle === 'failed' || document?.lifecycle === 'disposed') break;
      await this.page.waitForTimeout(50);
      document = await this.queryDocument(documentId);
    }
    if (document?.lifecycle !== 'ready') {
      throw new Error(`Document ${documentId} did not become ready: ${JSON.stringify(document)}`);
    }
    return document;
  }

  /**
   * Wait for an active document to own a usable GPU composite.
   *
   * `lifecycle: ready` only means that the canonical document has been
   * published. The renderer may still be waiting for its first animation
   * frame, in which case an immediate export can read the newly allocated,
   * transparent final texture. A submitted frame is the semantic boundary
   * exact pixel consumers need; queue ordering then makes the export readback
   * wait behind that composite without an arbitrary delay.
   */
  async waitForRenderedDocument(documentId, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let workspace = null;
    let document = null;
    let telemetry = null;
    while (Date.now() < deadline) {
      [workspace, document, telemetry] = await Promise.all([
        this.queryWorkspace(),
        this.queryDocument(documentId),
        this.queryRenderTelemetry(documentId)
      ]);
      if (document?.lifecycle === 'failed' || document?.lifecycle === 'disposed') break;
      if (workspace?.activeDocumentId === documentId
        && document?.lifecycle === 'ready'
        && document.renderer?.status === 'ready'
        && document.renderer.active
        && Boolean(document.canvas)
        && document.tasks?.activeCount === 0
        && telemetry?.presentedDocumentRevision === document.canonicalRevision
        && (telemetry?.submittedFrames ?? 0) > 0
        && (telemetry?.stages?.['document-composite']?.executions ?? 0) > 0) {
        return { document, telemetry };
      }
      await this.page.waitForTimeout(16);
    }
    throw new Error(`Document ${documentId} did not publish a rendered frame: ${JSON.stringify({
      activeDocumentId: workspace?.activeDocumentId ?? null,
      document,
      telemetry
    })}`);
  }

  async waitForLayers(documentId, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let layers = await this.queryLayers(documentId);
    while (!layers && Date.now() < deadline) {
      await this.page.waitForTimeout(50);
      layers = await this.queryLayers(documentId);
    }
    if (!layers) throw new Error(`Document ${documentId} did not publish its layer projection.`);
    return layers;
  }
}

export const attachLightTableAutomation = async (page, requestPrefix, timeout) => (
  new LightTableAutomationClient(page, requestPrefix).attach(timeout)
);
