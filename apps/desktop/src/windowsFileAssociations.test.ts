import { describe, expect, it, vi } from 'vitest';
import { createWindowsFileAssociationPlan, applyWindowsFileAssociationPlan } from './windowsFileAssociations';

describe('Windows bitmap file associations', () => {
  it('registers every alias as Open With capability without writing extension defaults', () => {
    const plan = createWindowsFileAssociationPlan('C:\\Apps\\LightTable\\LightTable.exe', 'register');
    for (const extension of ['.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.tif', '.tiff']) {
      expect(plan).toContainEqual(expect.objectContaining({
        kind: 'set', key: expect.stringContaining(`${extension}\\OpenWithProgids`)
      }));
      expect(plan).toContainEqual(expect.objectContaining({
        kind: 'set', key: expect.stringContaining('Capabilities\\FileAssociations'), name: extension
      }));
    }
    expect(plan.some((entry) => entry.kind === 'set'
      && /\\Classes\\\.[^\\]+$/.test(entry.key) && entry.name === undefined)).toBe(false);
  });

  it('removes only LightTable-owned keys and values', () => {
    const plan = createWindowsFileAssociationPlan('C:\\Apps\\LightTable\\LightTable.exe', 'unregister');
    expect(plan).toContainEqual({
      kind: 'delete-value',
      key: 'HKCU\\Software\\Classes\\.png\\OpenWithProgids',
      name: 'LightTable.png'
    });
    expect(plan).not.toContainEqual(expect.objectContaining({
      kind: 'delete-key', key: 'HKCU\\Software\\Classes\\.png'
    }));
  });

  it('executes registry mutations without a command shell', () => {
    const run = vi.fn(() => ({ status: 0 })) as unknown as Parameters<typeof applyWindowsFileAssociationPlan>[1];
    applyWindowsFileAssociationPlan([
      { kind: 'set', key: 'HKCU\\Software\\Test', name: 'Value', value: 'data' }
    ], run);
    expect(run).toHaveBeenCalledWith('reg.exe', [
      'add', 'HKCU\\Software\\Test', '/v', 'Value', '/t', 'REG_SZ', '/d', 'data', '/f'
    ], expect.objectContaining({ windowsHide: true }));
  });

  it('writes default values without an empty positional argument', () => {
    const run = vi.fn(() => ({ status: 0 })) as unknown as Parameters<typeof applyWindowsFileAssociationPlan>[1];
    applyWindowsFileAssociationPlan([
      { kind: 'set', key: 'HKCU\\Software\\Test\\shell\\open\\command', value: '"LightTable.exe" "%1"' }
    ], run);
    expect(run).toHaveBeenCalledWith('reg.exe', [
      'add', 'HKCU\\Software\\Test\\shell\\open\\command', '/ve', '/t', 'REG_SZ',
      '/d', '"LightTable.exe" "%1"', '/f'
    ], expect.objectContaining({ windowsHide: true }));
  });
});
