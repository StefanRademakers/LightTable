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

    const exported = await exportPsdDocument(
      createImageDocument('Document', 2, 2, 'background'),
      new Blob(['composite']),
      [],
      [],
      'document.png'
    );

    expect(exported.file.name).toBe('document.psd');
    expect(exported.warnings).toEqual(['layers[0]: Face Warp was baked.']);
    expect(exported.findings[0]?.severity).toBe('degraded-editability');
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
