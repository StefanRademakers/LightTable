import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from './types';
import {
  copyLightTableGrade,
  associateLightTableGradeArtifact,
  pasteGradeSettings,
  readLightTableGrade
} from './lightTableGradeClipboard';

const storage = new Map<string, string>();

describe('LightTable grade clipboard', () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      },
      dispatchEvent: vi.fn()
    });
  });

  it('persists a Grade-only payload that another document can read', () => {
    const source = createDefaultAdjustments();
    source.exposureEV = 1.5;
    source.effects.grain.enabled = true;

    copyLightTableGrade(source, 'Source document');
    const copied = readLightTableGrade();

    expect(copied).toMatchObject({
      name: 'Source document',
      settings: { exposureEV: 1.5 }
    });
    expect(copied?.settings.effects.grain.enabled).toBe(false);
  });

  it('preserves destination Lens FX when a cross-document Grade is pasted', () => {
    const destination = createDefaultAdjustments();
    destination.effects.lensDistortion.enabled = true;
    destination.effects.lensDistortion.amount = 42;
    const copied = createDefaultAdjustments();
    copied.contrast = 30;

    const pasted = pasteGradeSettings(destination, copied);

    expect(pasted.contrast).toBe(30);
    expect(pasted.effects.lensDistortion).toEqual(destination.effects.lensDistortion);
  });

  it('carries Grade Look bytes across documents without storing binary data in localStorage', () => {
    const source = createDefaultAdjustments();
    source.gradeLook = { assetId: 'lut-cinema', strength: 62 };
    const lut = new Blob(['TITLE "Cinema"\nLUT_3D_SIZE 2\n']);

    copyLightTableGrade(source, 'Look source', {
      assetId: 'lut-cinema', name: 'Cinema', source: lut
    });
    const copied = readLightTableGrade();

    expect(copied?.gradeLookAsset?.source).toBe(lut);
    expect(copied?.settings.gradeLook).toEqual({ assetId: 'lut-cinema', strength: 62 });
    expect([...storage.values()][0]).not.toContain('LUT_3D_SIZE');
  });

  it('distinguishes identical copies in the same millisecond and never associates an older capture', () => {
    vi.useFakeTimers();
    try {
      const association = { owner: {}, artifactId: 'artifact-1' };
      const first = copyLightTableGrade(createDefaultAdjustments(), 'Grade', undefined, association);
      const second = copyLightTableGrade(createDefaultAdjustments(), 'Grade');
      expect(second.copiedAt).toBe(first.copiedAt);
      expect(second.captureIdentity).not.toBe(first.captureIdentity);
      expect(readLightTableGrade()?.artifactAssociation).toBeUndefined();
      expect(associateLightTableGradeArtifact(first, association)).toBe(false);
      expect(associateLightTableGradeArtifact(second, association)).toBe(true);
      expect(readLightTableGrade()?.artifactAssociation).toBe(association);
      expect(readLightTableGrade()?.captureIdentity).toBe(second.captureIdentity);
    } finally { vi.useRealTimers(); }
  });

  it('leaves the previous session bytes and association intact when storage rejects Copy', () => {
    const association = { owner: {}, artifactId: 'previous' };
    const source = new Blob(['previous LUT']);
    const previous = copyLightTableGrade(createDefaultAdjustments(), 'Previous', {
      assetId: 'previous-lut', name: 'Previous', source
    }, association);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    expect(() => copyLightTableGrade(createDefaultAdjustments(), 'Failed')).toThrow('Storage full');
    expect(readLightTableGrade()).toMatchObject({ captureIdentity: previous.captureIdentity,
      gradeLookAsset: { source }, artifactAssociation: association });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
