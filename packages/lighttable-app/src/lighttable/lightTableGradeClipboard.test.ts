import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAdjustments } from './types';
import {
  copyLightTableGrade,
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
});
