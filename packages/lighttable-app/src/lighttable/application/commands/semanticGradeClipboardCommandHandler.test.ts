import { describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from '../../types';
import { LightTableArtifactRegistry } from './lightTableArtifactRegistry';
import { SemanticGradeClipboardCommandHandler } from './semanticGradeClipboardCommandHandler';
import type { LightTableCommandPorts } from './lightTableCommandContract';

const documentId = 'document-1' as never;

const capture = () => {
  const settings = createDefaultAdjustments();
  settings.exposureEV = 1.25;
  settings.effects.grain.enabled = true;
  settings.gradeLook = { assetId: 'lut-source', strength: 62 };
  return {
    name: 'Portrait',
    settings,
    gradeLookAsset: {
      assetId: 'lut-source',
      name: 'Cinema',
      source: new Blob(['TITLE "Cinema"\nLUT_3D_SIZE 2\n'])
    }
  };
};

describe('SemanticGradeClipboardCommandHandler', () => {
  it('keeps recipe and raw Look bytes in one bounded opaque artifact', async () => {
    const registry = new LightTableArtifactRegistry();
    const handler = new SemanticGradeClipboardCommandHandler(registry);
    const source = capture();
    const copyGrade = vi.fn(async () => source);
    const pasteGrade = vi.fn(async (captureValue) => ({
      name: captureValue.name,
      changed: true,
      hasLookAsset: Boolean(captureValue.gradeLookAsset),
      importedLookAsset: true
    }));
    const ports = { copyGrade, pasteGrade } as unknown as LightTableCommandPorts;

    const copied = await handler.dispatch('grade.copy', {}, documentId, ports);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const value = copied.value as { artifact: { id: string; kind: string; byteLength: number } };
    expect(value.artifact.kind).toBe('grade-clipboard');
    expect(value.artifact.byteLength).toBeGreaterThan(source.gradeLookAsset.source.size);
    const file = registry.resolve(value.artifact.id)!;
    expect(await file.text()).not.toContain('base64');

    const pasted = await handler.dispatch('grade.paste', {
      artifactId: value.artifact.id
    }, documentId, ports);
    expect(pasted).toMatchObject({ ok: true, mutated: true });
    expect(pasteGrade).toHaveBeenCalledWith(documentId, expect.objectContaining({
      name: 'Portrait',
      settings: expect.objectContaining({
        exposureEV: 1.25,
        effects: expect.objectContaining({ grain: expect.objectContaining({ enabled: false }) })
      }),
      gradeLookAsset: expect.objectContaining({ source: source.gradeLookAsset.source })
    }));
  });

  it('rejects private parameters and released artifacts without invoking Paste', async () => {
    const registry = new LightTableArtifactRegistry();
    const handler = new SemanticGradeClipboardCommandHandler(registry);
    const pasteGrade = vi.fn();
    const artifact = handler.register(capture());
    registry.release(artifact.id);
    const ports = { pasteGrade } as unknown as LightTableCommandPorts;

    expect(await handler.dispatch('grade.paste', {
      artifactId: artifact.id,
      settings: {}
    }, documentId, ports)).toMatchObject({ ok: false, code: 'invalid-parameters' });
    expect(await handler.dispatch('grade.paste', {
      artifactId: artifact.id
    }, documentId, ports)).toMatchObject({ ok: false, code: 'command-unavailable' });
    expect(pasteGrade).not.toHaveBeenCalled();
  });

  it('rejects mismatched or oversized Look payloads before registration', () => {
    const handler = new SemanticGradeClipboardCommandHandler(new LightTableArtifactRegistry());
    const mismatched = capture();
    mismatched.gradeLookAsset.assetId = 'other-lut';
    expect(() => handler.register(mismatched)).toThrow(/missing, mismatched or exceeds/u);

    const oversized = capture();
    oversized.gradeLookAsset.source = new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]);
    expect(() => handler.register(oversized)).toThrow(/missing, mismatched or exceeds/u);
  });

  it('never reports a command Copy as complete when an active Look lost its bytes', async () => {
    const registry = new LightTableArtifactRegistry();
    const handler = new SemanticGradeClipboardCommandHandler(registry);
    const source = capture();
    const incomplete = { name: source.name, settings: source.settings };
    const copyGrade = vi.fn(async () => incomplete);

    expect(await handler.dispatch('grade.copy', {}, documentId, {
      copyGrade
    } as unknown as LightTableCommandPorts)).toMatchObject({
      ok: false,
      code: 'execution-failed',
      message: expect.stringMatching(/could not be captured/u)
    });

    // The legacy persisted text clipboard remains intentionally usable: its
    // paste owner removes a foreign missing LUT and applies the remaining Grade.
    expect(handler.register(incomplete).kind).toBe('grade-clipboard');
  });
});
