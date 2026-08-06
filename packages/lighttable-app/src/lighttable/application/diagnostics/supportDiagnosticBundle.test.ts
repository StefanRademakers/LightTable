import { describe, expect, it } from 'vitest';
import { createSupportDiagnosticArtifact, SUPPORT_DIAGNOSTIC_MAX_EVENTS } from './supportDiagnosticBundle';
import { redactDiagnosticText } from './supportDiagnosticBundle';

const baseInput = (events: Array<{ id: number; timestamp: number; severity: 'info' | 'warning' | 'error'; source: string; message: string; details?: string }> = []) => ({
  now: Date.UTC(2026, 7, 6),
  hostKind: 'electron' as const,
  release: null,
  gpu: null,
  metadata: { name: 'secret-client.psd', width: 400, height: 400, contentType: 'image/vnd.adobe.photoshop' },
  sourceFileName: 'secret-client.psd',
  document: null,
  startupTimings: null,
  gpuMemoryBytes: null,
  textRender: null,
  events
});

describe('support diagnostic bundle', () => {
  it('redacts paths, URLs, secrets, filenames and content canaries in JSON and summary', () => {
    const artifact = createSupportDiagnosticArtifact(baseInput([{
      id: 1,
      timestamp: 1,
      severity: 'error',
      source: 'Renderer',
      message: 'secret-client.psd failed at D:\\Clients\\Acme\\secret-client.psd https://private.example/doc',
      details: 'Bearer abc.def pairing-code=842199 document content: CANARY_DOCUMENT_TEXT data:image/png;base64,QUJDREVGRw=='
    }]), { includeFileName: false });
    for (const output of [artifact.json, artifact.summary]) {
      expect(output).not.toContain('secret-client.psd');
      expect(output).not.toContain('D:\\Clients');
      expect(output).not.toContain('private.example');
      expect(output).not.toContain('abc.def');
      expect(output).not.toContain('842199');
      expect(output).not.toContain('CANARY_DOCUMENT_TEXT');
      expect(output).not.toContain('QUJDREVGRw');
    }
    expect(artifact.json).toContain('[redacted-path]');
    expect(artifact.json).toContain('[redacted-url]');
    const attachment = (artifact.bundle.attachments as Array<{ content: string }>)[0].content;
    expect(attachment).not.toContain('secret-client.psd');
    expect(attachment).toContain('[redacted-filename]');
    expect(redactDiagnosticText('layout failed for PRIVATE HEADLINE', { includeFileName: false }, null, ['PRIVATE HEADLINE']))
      .toBe('layout failed for [redacted-document-content]');
  });

  it('retains unavailable state rather than fabricating zero samples', () => {
    const artifact = createSupportDiagnosticArtifact(baseInput(), { includeFileName: false });
    expect(artifact.bundle.timings).toMatchObject({ status: 'unavailable' });
    expect(artifact.bundle.gpu).toMatchObject({ status: 'unavailable' });
    expect(artifact.bundle.resources).toMatchObject({
      gpuTextureBytes: { status: 'unavailable' }
    });
  });

  it('bounds event count and collection is snapshot-only', () => {
    const events = Array.from({ length: 500 }, (_, id) => ({
      id, timestamp: id, severity: 'info' as const, source: 'Stress', message: `event-${id}-${'x'.repeat(1000)}`
    }));
    const artifact = createSupportDiagnosticArtifact(baseInput(events), { includeFileName: false });
    const bounded = artifact.bundle.events as { entries: unknown[]; retainedBytes: number; omitted: number };
    expect(bounded.entries.length).toBeLessThanOrEqual(SUPPORT_DIAGNOSTIC_MAX_EVENTS);
    expect(bounded.retainedBytes).toBeLessThanOrEqual(64 * 1024);
    expect(bounded.omitted).toBeGreaterThan(0);
    expect(artifact.bundle.collection).toEqual({
      source: 'existing-snapshots-only', rendererRecompositions: 0, gpuReadbacks: 0
    });
  });

  it.each([
    ['image/png', 'png'],
    ['image/vnd.adobe.photoshop', 'psd'],
    ['application/pdf', 'pdf']
  ])('represents %s documents without embedding payloads', (contentType) => {
    const artifact = createSupportDiagnosticArtifact({
      ...baseInput(),
      sourceFileName: `private-file.${contentType === 'application/pdf' ? 'pdf' : contentType.includes('photoshop') ? 'psd' : 'png'}`,
      metadata: { name: 'private-file.bin', width: 320, height: 240, contentType: 'image/png' }
    }, { includeFileName: false });
    expect(artifact.json).toContain(contentType);
    expect(artifact.json).not.toContain('private-file.bin');
  });
});
