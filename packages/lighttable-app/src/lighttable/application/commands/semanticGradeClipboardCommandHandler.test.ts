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
  it.each(['stale-before-register', 'stale-before-publish', 'publication-failed'])(
    'does not retain an unpublished artifact on %s', async failure => {
      const registry = new LightTableArtifactRegistry();
      const handler = new SemanticGradeClipboardCommandHandler(registry);
      const assertCurrent = vi.fn(() => {
        if (failure === 'stale-before-register' || (failure === 'stale-before-publish' && assertCurrent.mock.calls.length === 2)) {
          throw new Error('Source retired');
        }
      });
      const publish = vi.fn(() => { if (failure === 'publication-failed') throw new Error('Storage full'); });
      const result = await handler.dispatch('grade.copy', {}, documentId, {
        copyGrade: () => ({ capture: capture(), assertCurrent, publish })
      } as unknown as LightTableCommandPorts);
      expect(result).toMatchObject({ ok: false, code: 'execution-failed' });
      expect(registry.list()).toHaveLength(0);
      expect(publish).toHaveBeenCalledTimes(failure === 'publication-failed' ? 1 : 0);
    });

  it('reuses only its own live artifact and registers persisted, evicted or foreign captures without Copy', () => {
    const registry = new LightTableArtifactRegistry();
    const handler = new SemanticGradeClipboardCommandHandler(registry);
    const source = capture();
    const first = handler.resolveArtifact(source);
    expect(handler.resolveArtifact(source, first.association).artifact).toBe(first.artifact);
    expect(registry.list()).toHaveLength(1);
    registry.release(first.artifact.id);
    const recreated = handler.resolveArtifact(source, first.association);
    expect(recreated.artifact.id).not.toBe(first.artifact.id);
    const other = new SemanticGradeClipboardCommandHandler(new LightTableArtifactRegistry());
    const transferred = other.resolveArtifact(source, recreated.association);
    expect(transferred.association.owner).not.toBe(recreated.association.owner);
    expect(transferred.artifact.kind).toBe('grade-clipboard');
  });
  it('keeps recipe and raw Look bytes in one bounded opaque artifact', async () => {
    const registry = new LightTableArtifactRegistry();
    const handler = new SemanticGradeClipboardCommandHandler(registry);
    const source = capture();
    const copyGrade = vi.fn(async () => ({ capture: source, assertCurrent: vi.fn(), publish: vi.fn() }));
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
    const publish = vi.fn();
    const copyGrade = vi.fn(async () => ({ capture: incomplete, assertCurrent: vi.fn(), publish }));

    expect(await handler.dispatch('grade.copy', {}, documentId, {
      copyGrade
    } as unknown as LightTableCommandPorts)).toMatchObject({
      ok: false,
      code: 'execution-failed',
      message: expect.stringMatching(/could not be captured/u)
    });

    expect(publish).not.toHaveBeenCalled();
    expect(registry.list()).toHaveLength(0);
    // The legacy persisted text clipboard remains intentionally usable: its
    // paste owner removes a foreign missing LUT and applies the remaining Grade.
    expect(handler.register(incomplete).kind).toBe('grade-clipboard');
  });
});
