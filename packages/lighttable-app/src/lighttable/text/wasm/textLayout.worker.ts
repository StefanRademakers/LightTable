/// <reference lib="webworker" />

import initializeTextLayoutWasm, {
  inspect_font_json as inspectFontJson,
  text_engine_version as textEngineVersion
} from './generated/text_layout_wasm.js';
import {
  TEXT_ENGINE_PROTOCOL_VERSION,
  type TextEngineWorkerRequest,
  type TextEngineWorkerResponse
} from './textEngineProtocol';

let initialization: Promise<{ engineVersion: string; loadDurationMs: number }> | null = null;

const initialize = () => {
  initialization ??= (async () => {
    const startedAt = performance.now();
    await initializeTextLayoutWasm();
    return {
      engineVersion: textEngineVersion(),
      loadDurationMs: performance.now() - startedAt
    };
  })();
  return initialization;
};

self.onmessage = async ({ data }: MessageEvent<TextEngineWorkerRequest>) => {
  let response: TextEngineWorkerResponse;
  if (data.protocolVersion !== TEXT_ENGINE_PROTOCOL_VERSION) {
    response = {
      kind: 'error',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId: data.requestId,
      message: `Unsupported text engine protocol ${data.protocolVersion}.`
    };
    self.postMessage(response);
    return;
  }

  try {
    const capability = await initialize();
    response = data.kind === 'probe'
      ? {
          kind: 'ready',
          protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
          requestId: data.requestId,
          ...capability
        }
      : {
          kind: 'font-inspected',
          protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
          requestId: data.requestId,
          ...JSON.parse(inspectFontJson(new Uint8Array(data.bytes), data.faceIndex))
        };
  } catch (error) {
    initialization = null;
    response = {
      kind: 'error',
      protocolVersion: TEXT_ENGINE_PROTOCOL_VERSION,
      requestId: data.requestId,
      message: error instanceof Error ? error.message : 'The text engine failed to initialize.'
    };
  }
  self.postMessage(response);
};
