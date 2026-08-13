import { describe, expect, it } from 'vitest';
import {
  containsLightTableDocumentDrag,
  LIGHTTABLE_DOCUMENT_DRAG_TYPE,
  readLightTableDocumentDrag,
  writeLightTableDocumentDrag
} from './documentTabDrag';

describe('document tab drag payload', () => {
  it('round-trips a document id without depending on its thumbnail', () => {
    const values = new Map<string, string>();
    const transfer = {
      effectAllowed: 'none',
      types: [LIGHTTABLE_DOCUMENT_DRAG_TYPE],
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ''
    } as unknown as DataTransfer;
    writeLightTableDocumentDrag(transfer, 'document-42', 'Portrait');
    expect(readLightTableDocumentDrag(transfer)).toBe('document-42');
    expect(containsLightTableDocumentDrag(transfer)).toBe(true);
  });
});
