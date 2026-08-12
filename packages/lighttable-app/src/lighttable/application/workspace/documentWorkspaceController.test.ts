import { describe, expect, it } from 'vitest';
import type { DocumentSessionId } from '../documents/documentSession';
import { DocumentWorkspaceController } from './documentWorkspaceController';

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++] as DocumentSessionId;
};

const source = (id: string) => ({
  id,
  name: `${id}.png`,
  mediaType: 'image/png'
});

describe('DocumentWorkspaceController', () => {
  it('keeps opaque host source handles aligned with document lifetime', () => {
    const controller = new DocumentWorkspaceController<{ token: string }>({
      createId: ids('one', 'two')
    });
    const first = controller.open({
      source: source('first'),
      payload: { token: 'first-source' }
    });
    const second = controller.open({
      source: source('second'),
      payload: { token: 'second-source' }
    });
    if (!first.ok || !second.ok) throw new Error('Fixture failed to open.');

    expect(controller.getSource(first.value.id)).toEqual({ token: 'first-source' });
    expect(controller.getSource(second.value.id)).toEqual({ token: 'second-source' });
    controller.close(first.value.id);
    expect(controller.getSource(first.value.id)).toBeNull();
    expect(controller.getSource(second.value.id)).toEqual({ token: 'second-source' });
  });

  it('activates and returns the existing session when the same source opens again', () => {
    const controller = new DocumentWorkspaceController<string>({
      createId: ids('one', 'two')
    });
    const first = controller.open({ source: source('same'), payload: 'original' });
    if (!first.ok) throw new Error('Fixture failed to open.');

    const duplicate = controller.open({ source: source('same'), payload: 'replacement' });
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) throw new Error('Duplicate source should resolve to its existing session.');
    expect(duplicate.value).toBe(first.value);
    expect(controller.getSnapshot().documentOrder).toEqual(['one']);
    expect(controller.getSnapshot().activeDocumentId).toBe('one');
    expect(controller.getSource(first.value.id)).toBe('original');
  });

  it('disposes sessions and source handles as one ownership boundary', () => {
    const controller = new DocumentWorkspaceController<string>({
      createId: ids('one')
    });
    const opened = controller.open({ source: source('first'), payload: 'source' });
    if (!opened.ok) throw new Error('Fixture failed to open.');

    controller.dispose();
    expect(opened.value.getSnapshot().lifecycle).toBe('disposed');
    expect(() => controller.getSource(opened.value.id)).toThrow(/disposed/);
  });

  it('keeps the external-store read contract safe after terminal disposal', () => {
    const controller = new DocumentWorkspaceController<string>({
      createId: ids('one')
    });
    const opened = controller.open({ source: source('first'), payload: 'source' });
    if (!opened.ok) throw new Error('Fixture failed to open.');

    controller.dispose();

    expect(controller.getSnapshot()).toMatchObject({
      activeDocumentId: null,
      documentOrder: []
    });
    const unsubscribe = controller.subscribe(() => {
      throw new Error('A disposed controller must never publish again.');
    });
    expect(unsubscribe()).toBeUndefined();
    expect(() => controller.open({
      source: source('second'),
      payload: 'source'
    })).toThrow(/disposed/);
  });
});
