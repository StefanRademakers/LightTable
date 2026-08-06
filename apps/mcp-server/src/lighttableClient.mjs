const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export class LightTableBridgeClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = new URL(baseUrl);
    this.token = token;
    this.fetch = fetchImpl;
    if (!this.token || this.token.length < 24) throw new Error('LIGHTTABLE_BRIDGE_TOKEN must contain at least 24 characters.');
  }

  async invoke(method, parameters = {}) {
    const response = await this.fetch(new URL('/invoke', this.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, requestId: crypto.randomUUID(), method, parameters })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !isObject(result)) {
      throw new Error(`LightTable bridge failed with HTTP ${response.status}.`);
    }
    if (result.status === 'rejected') throw new Error(result.message ?? 'LightTable rejected the request.');
    return result.value;
  }

  async uploadArtifact({ bytes, name, mediaType }) {
    const response = await this.fetch(new URL('/artifacts', this.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': mediaType || 'application/octet-stream',
        'x-lighttable-filename': encodeURIComponent(name)
      },
      body: bytes
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !isObject(result)) {
      throw new Error(`LightTable artifact upload failed with HTTP ${response.status}.`);
    }
    return result;
  }

  async readArtifact(artifactId) {
    const response = await this.fetch(new URL(`/artifacts/${encodeURIComponent(artifactId)}`, this.baseUrl), {
      headers: { authorization: `Bearer ${this.token}` }
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(`LightTable artifact read failed with HTTP ${response.status}: ${detail?.error ?? 'unknown error'}.`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
      name: decodeURIComponent(response.headers.get('x-lighttable-filename') ?? artifactId)
    };
  }
}

export class MockLightTableClient {
  constructor() {
    this.revision = 1;
    this.document = {
      id: 'document-demo', title: 'MCP Demo', lifecycle: 'ready', dirty: false,
      canonicalRevision: 1, savedRevision: 1, canvas: { width: 1200, height: 800 },
      activeLayerId: 'layer-background', layerCount: 1,
      viewport: { scale: 1, offsetX: 0, offsetY: 0, zoomMode: 'fit' },
      history: { canUndo: false, canRedo: false, busy: false, undoDepth: 0,
        redoDepth: 0, estimatedBytes: 0, currentStateId: 1 },
      tasks: { activeCount: 0 }, renderer: { status: 'ready', active: true, estimatedGpuBytes: 0 }
    };
    this.layers = [{ id: 'layer-background', parentId: null, depth: 0, type: 'raster',
      name: 'Background', visible: true, opacity: 1, fillOpacity: 1, blendMode: 'normal',
      clipping: false, hasMask: false, hasActiveEffects: false,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      rasterSurface: { width: 1200, height: 800, offsetX: 0, offsetY: 0 }, textLayout: null }];
  }

  async invoke(method, parameters = {}) {
    if (method === 'workspace.query') return { revision: this.revision,
      activeDocumentId: this.document.id, documents: [{ id: this.document.id,
        title: this.document.title, lifecycle: 'ready', dirty: this.document.dirty,
        source: { name: 'mcp-demo.lighttable', mediaType: 'application/x-lighttable' } }] };
    if (method === 'document.query') return parameters.documentId === this.document.id ? this.document : null;
    if (method === 'layer.list') return parameters.documentId === this.document.id ? this.layers : null;
    if (method === 'layer.effects') return { layerId: parameters.layerId, enabled: true, revision: 0, effects: [] };
    if (method === 'text.query') return { layerId: parameters.layerId, sourceKind: 'flow', editable: true,
      revision: 1, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      content: { text: 'Text', totalLength: 4, truncated: false }, layout: { mode: 'point' },
      styleRuns: [], paragraphRuns: [], runsTruncated: false };
    if (method === 'vector.query') return { layerId: parameters.layerId, revision: 1,
      totalElements: 0, truncated: false, elements: [] };
    if (method === 'command.capabilities') return ['layer.createRaster', 'layer.rename',
      'layer.setVisibility', 'layer.setFillOpacity', 'history.undo', 'history.redo']
      .map((command) => ({ command, available: true, reason: null }));
    if (method === 'artifact.list') return [];
    if (method === 'task.events') return { cursor: 0, events: [] };
    if (method === 'command.execute') {
      if (parameters.command === 'command.batch') {
        const title = parameters.commandParameters?.operations?.find((operation) => operation.operationId === 'title');
        if (title?.parameters?.text) this.layers.push({ id: 'layer-agent-title', parentId: null, depth: 0, type: 'text',
          name: title.parameters.text, visible: true, opacity: 1, fillOpacity: 1, blendMode: 'normal', clipping: false,
          hasMask: false, hasActiveEffects: true, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          rasterSurface: null, textLayout: { mode: 'point' } });
      }
      this.revision += 1; this.document.canonicalRevision += 1; this.document.dirty = true;
      return { requestId: parameters.commandRequestId, status: 'completed', value: { changed: true },
        revisions: { workspace: this.revision, document: this.document.canonicalRevision } };
    }
    throw new Error(`Mock LightTable does not implement ${method}.`);
  }
}
