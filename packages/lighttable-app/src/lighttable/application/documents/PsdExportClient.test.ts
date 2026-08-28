import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { exportPsdDocument } from './PsdExportClient';
import type { PsdExportRequest, PsdExportResponse } from './psdExportProtocol';

let responseFor: (request: PsdExportRequest) => PsdExportResponse;

class WorkerStub {
  onmessage: ((event: MessageEvent<PsdExportResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: PsdExportRequest) {
    queueMicrotask(() => this.onmessage?.({ data: responseFor(request) } as MessageEvent<PsdExportResponse>));
  }

  terminate() {}
}

afterEach(() => vi.unstubAllGlobals());

describe('PSD export compatibility policy', () => {
  it('terminates a running export worker when its document task is canceled', async () => {
    const terminate = vi.fn();
    class HangingWorker {
      onmessage: ((event: MessageEvent<PsdExportResponse>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage() {}
      terminate = terminate;
    }
    vi.stubGlobal('Worker', HangingWorker);
    const controller = new AbortController();
    const exporting = exportPsdDocument(
      createImageDocument('Document', 2, 2, 'background'),
      new Blob(['composite']), [], [], 'document.png', 'editable', controller.signal
    );

    controller.abort();

    await expect(exporting).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminate).toHaveBeenCalled();
  });

  it('allows an appearance-preserving degraded-editability finding', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    responseFor = (request) => ({
      requestId: request.requestId,
      status: 'success',
      bytes: new Uint8Array([56, 66, 80, 83]),
      findings: [{
        severity: 'degraded-editability',
        code: 'face-warp-baked',
        path: 'layers[0]',
        message: 'Face Warp was baked.'
      }],
      warnings: ['layers[0]: Face Warp was baked.'],
      blockingWarnings: [],
      editableTextLayers: 0,
      editableVectorLayers: 0
    });

    const document = createImageDocument('Document', 2, 2, 'background');
    document.colorSettings.bitDepth = 8;
    const exported = await exportPsdDocument(
      document,
      new Blob(['composite']),
      [],
      [],
      'document.png'
    );

    expect(exported.file.name).toBe('document.psd');
    expect(exported.warnings).toEqual(['layers[0]: Face Warp was baked.']);
    expect(exported.findings[0]?.severity).toBe('degraded-editability');
  });

  it('reports the actual 8-bit PSD writer boundary for a 16-bit document', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    responseFor = (request) => ({
      requestId: request.requestId,
      status: 'success',
      bytes: new Uint8Array([56, 66, 80, 83]),
      findings: [],
      warnings: [],
      blockingWarnings: [],
      editableTextLayers: 0,
      editableVectorLayers: 0
    });

    const document = createImageDocument('16-bit document', 2, 2, 'background');
    document.colorSettings.bitDepth = 16;
    const exported = await exportPsdDocument(
      document,
      new Blob(['composite']),
      [],
      [],
      'document.png'
    );

    expect(exported.findings).toContainEqual({
      severity: 'degraded-fidelity',
      code: 'psd-8-bit-export',
      path: 'document.colorSettings.bitDepth',
      message: 'The current PSD writer encodes 8 bits/channel; this 16-bit LightTable document is quantized only at the PSD boundary.'
    });
    expect(exported.warnings).toEqual([
      'document.colorSettings.bitDepth: The current PSD writer encodes 8 bits/channel; this 16-bit LightTable document is quantized only at the PSD boundary.'
    ]);
  });

  it('stops an editable export when appearance cannot be preserved', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    responseFor = (request) => ({
      requestId: request.requestId,
      status: 'success',
      bytes: new Uint8Array(),
      findings: [{
        severity: 'blocking',
        code: 'grade-unprojectable',
        path: 'layers[1]',
        message: 'Grade cannot be projected.'
      }],
      warnings: ['layers[1]: Grade cannot be projected.'],
      blockingWarnings: ['layers[1]: Grade cannot be projected.'],
      editableTextLayers: 0,
      editableVectorLayers: 0
    });

    await expect(exportPsdDocument(
      createImageDocument('Document', 2, 2, 'background'),
      new Blob(['composite']),
      [],
      [],
      'document.png'
    )).rejects.toThrow(
      'Photoshop export was stopped to prevent appearance loss:\nlayers[1]: Grade cannot be projected.'
    );
  });
});
