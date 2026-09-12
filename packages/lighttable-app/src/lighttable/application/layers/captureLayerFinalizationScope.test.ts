import { describe, expect, it } from 'vitest';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import { createImageDocument } from '../../editor/document/documentTypes';
import { captureLayerFinalizationScope } from './captureLayerFinalizationScope';

const fixture = () => {
  const workspace = new WorkspaceSession({ createId: () => 'same-public-id' as never });
  const opened = workspace.open({ source: { id: 'image', name: 'Image', mediaType: 'image/png' } });
  if (!opened.ok) throw new Error('Fixture failed');
  const session = opened.value; session.setDocument(createImageDocument('Image', 10, 10, 'image')); session.setReady();
  return { workspace, session };
};

describe('finalization concrete host scope', () => {
  it('rejects a different session with the same public ID and disposal before React cleanup', () => {
    const first = fixture(); const second = fixture(); const renderer = {};
    let current = first.session;
    const host = { getCurrentSession: () => current, getCurrentRenderer: () => renderer,
      captureRendererScope: () => ({ assertCurrent: () => undefined }) };
    const scope = captureLayerFinalizationScope(first.session, renderer, host);
    current = second.session;
    expect(current.id).toBe(first.session.id);
    expect(scope.assertCurrent).toThrow('retired');
    expect(() => captureLayerFinalizationScope(first.session, renderer, host)).toThrow('retired');
    current = first.session; first.session.dispose();
    expect(scope.assertCurrent).toThrow('retired');
    first.workspace.dispose(); second.workspace.dispose();
  });

  it('allows same-session publication but pins renderer identity and generation', () => {
    const f = fixture(); let renderer = {}; let generation = 1; const lifecycle = {};
    const host = { getCurrentSession: () => f.session, getCurrentRenderer: () => renderer,
      captureRendererScope: () => captureInteractionScope({ getWorkspaceId: () => f.session.id,
        getLifecycleIdentity: () => lifecycle, getRenderer: () => renderer, getRendererGeneration: () => generation }) };
    const scope = captureLayerFinalizationScope(f.session, renderer, host);
    const document = f.session.getSnapshot().document!;
    f.session.setDocument({ ...document, revision: document.revision + 1 });
    expect(scope.assertCurrent).not.toThrow();
    generation++; expect(scope.assertCurrent).toThrow('retired');
    const next = captureLayerFinalizationScope(f.session, renderer, host);
    renderer = {}; expect(next.assertCurrent).toThrow('retired'); f.workspace.dispose();
  });
});
