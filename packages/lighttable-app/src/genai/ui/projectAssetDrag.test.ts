import { describe, expect, it } from 'vitest';
import type { GenAiAssetId } from '@lighttable/genai-core';
import { containsProjectAssetDrag, PROJECT_ASSET_DRAG_TYPE, readProjectAssetDrag, writeProjectAssetDrag } from './projectAssetDrag';

class TransferStub {
  effectAllowed = 'none';
  private readonly values = new Map<string, string>();
  get types() { return [...this.values.keys()]; }
  setData(type: string, value: string) { this.values.set(type, value); }
  getData(type: string) { return this.values.get(type) ?? ''; }
}

describe('project asset drag payload', () => {
  it('round-trips only the stable project asset id', () => {
    const transfer = new TransferStub() as unknown as DataTransfer;
    writeProjectAssetDrag(transfer, 'asset-1' as GenAiAssetId, 'Portrait.png');
    expect(containsProjectAssetDrag(transfer)).toBe(true);
    expect(readProjectAssetDrag(transfer)).toBe('asset-1');
    expect(transfer.getData(PROJECT_ASSET_DRAG_TYPE)).toBe('asset-1');
    expect(transfer.effectAllowed).toBe('copy');
  });
});
