import { describe, expect, it } from 'vitest';
import { LIGHTTABLE_PRODUCT_DISCLOSURES } from './thirdPartyDisclosures.generated';

describe('third-party product disclosures', () => {
  it('contains meaningful product components without exposing utility dependencies', () => {
    const names = LIGHTTABLE_PRODUCT_DISCLOSURES.map(({ name }) => name);

    expect(names).toContain('Electron and Chromium runtime');
    expect(names).toContain('ag-psd');
    expect(names).toContain('Parley');
    expect(names).toContain('Transformers.js');
    expect(names).not.toContain('zod');
    expect(names).not.toContain('express');
    expect(names).not.toContain('Model Context Protocol');
    const licenses: readonly string[] = LIGHTTABLE_PRODUCT_DISCLOSURES.map(({ license }) => license);
    expect(licenses).not.toContain('UNKNOWN');
  });
});
