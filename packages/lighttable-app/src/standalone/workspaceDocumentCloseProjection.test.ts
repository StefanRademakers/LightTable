import { describe, expect, it } from 'vitest';
import type { DocumentSessionId } from '../lighttable/application/documents/documentSession';
import { nextActiveDocumentAfterClose } from './workspaceDocumentCloseProjection';

const id = (value: string) => value as DocumentSessionId;

describe('workspace document close projection', () => {
  it('retains the active owner when an inactive document closes', () => {
    expect(nextActiveDocumentAfterClose([id('a'), id('b')], id('a'), id('b'))).toBe(id('a'));
  });

  it('selects the adjacent owner with the same ordering rule as the workspace', () => {
    expect(nextActiveDocumentAfterClose([id('a'), id('b'), id('c')], id('b'), id('b'))).toBe(id('c'));
    expect(nextActiveDocumentAfterClose([id('a'), id('b'), id('c')], id('c'), id('c'))).toBe(id('b'));
    expect(nextActiveDocumentAfterClose([id('a')], id('a'), id('a'))).toBeNull();
  });
});
