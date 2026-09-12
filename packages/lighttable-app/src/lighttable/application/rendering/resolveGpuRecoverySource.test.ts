import { afterEach, expect, it } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { resolveGpuRecoverySource } from './resolveGpuRecoverySource';

const sessions: DocumentSession[] = [];
const session = () => {
  const current = new DocumentSession({ id: 'recovery' as DocumentSessionId, source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  sessions.push(current); return current;
};
afterEach(() => { for (const current of sessions.splice(0)) current.dispose(); });

it('requires a canonical owner and does not infer that a missing ready document is empty', () => {
  expect(resolveGpuRecoverySource(undefined)).toEqual({ kind: 'unavailable' });
  const current = session(); current.setReady();
  expect(resolveGpuRecoverySource(current)).toEqual({ kind: 'unavailable' });
});

it('recognizes untouched initial startup before and after its failed startup', () => {
  const current = session(); expect(resolveGpuRecoverySource(current)).toEqual({ kind: 'startup' });
  current.setFailed('WebGPU device lost: startup');
  expect(resolveGpuRecoverySource(current)).toEqual({ kind: 'startup' });
});

it.each(['opening', 'ready', 'failed'] as const)('reads the exact live canonical document while %s', lifecycle => {
  const current = session();
  if (lifecycle === 'ready') current.setReady();
  if (lifecycle === 'failed') current.setFailed('device lost');
  const first = createImageDocument('first', 32, 32, 'source'); current.setDocument(first);
  const second = { ...first, title: 'later canonical state' }; current.setDocument(second);
  const resolved = resolveGpuRecoverySource(current);
  expect(resolved.kind).toBe('document');
  if (resolved.kind === 'document') expect(resolved.document).toBe(current.getSnapshot().document);
});

it('does not reclassify cleared authored state or partially loaded payload as fresh startup', () => {
  const current = session(); current.setDocument(createImageDocument('authored', 32, 32, 'source')); current.setDocument(null);
  expect(resolveGpuRecoverySource(current)).toEqual({ kind: 'unavailable' });
  const partial = session(); partial.updateLoadedSource(source => ({ ...source, blob: new Blob(['source']) }));
  expect(resolveGpuRecoverySource(partial)).toEqual({ kind: 'unavailable' });
});

it.each(['closing', 'disposed'] as const)('rejects %s sessions even when their former document had canonical content', state => {
  const current = session(); current.setDocument(createImageDocument('authored', 32, 32, 'source'));
  if (state === 'closing') current.beginClosing(); else current.dispose();
  expect(resolveGpuRecoverySource(current)).toEqual({ kind: 'unavailable' });
});
