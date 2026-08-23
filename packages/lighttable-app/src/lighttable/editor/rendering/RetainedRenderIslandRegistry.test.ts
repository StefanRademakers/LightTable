import { describe, expect, it } from 'vitest';
import { createGroupLayer, createVectorLayer } from '../document/documentTypes';
import { planRenderIslands } from './RenderIslandPlanner';
import { RetainedRenderIslandRegistry } from './RetainedRenderIslandRegistry';

const vector = (name: string) => createVectorLayer([], name);

describe('RetainedRenderIslandRegistry', () => {
  it('keeps resource identity across visibility and canonical object replacement', () => {
    const first = vector('first');
    const second = vector('second');
    const registry = new RetainedRenderIslandRegistry();
    const initial = registry.reconcile(planRenderIslands([first, second]));
    second.visible = false;
    const hidden = registry.reconcile(planRenderIslands([
      { ...first }, { ...second }
    ]));

    expect(hidden.islands[0].resourceId).toBe(initial.islands[0].resourceId);
    expect(hidden.releasedResourceIds).toEqual([]);
  });

  it('retains the overlapping resource on a split and releases it only after deletion', () => {
    const first = vector('first');
    const second = vector('second');
    const registry = new RetainedRenderIslandRegistry();
    const initial = registry.reconcile(planRenderIslands([first, second]));
    second.opacity = 0.5;
    const split = registry.reconcile(planRenderIslands([first, second]));

    expect(split.islands).toHaveLength(2);
    expect(split.islands[0].resourceId).toBe(initial.islands[0].resourceId);
    expect(split.islands[1].resourceId).not.toBe(initial.islands[0].resourceId);
    expect(split.releasedResourceIds).toEqual([]);

    const removed = registry.reconcile(planRenderIslands([second]));
    expect(removed.islands[0].resourceId).toBe(split.islands[1].resourceId);
    expect(removed.releasedResourceIds).toEqual([split.islands[0].resourceId]);
  });

  it('keys isolated groups by their canonical owner across child edits', () => {
    const child = vector('child');
    const group = createGroupLayer('opacity group');
    group.opacity = 0.5;
    group.children = [child];
    const registry = new RetainedRenderIslandRegistry();
    const initial = registry.reconcile(planRenderIslands([group]));
    group.children.push(vector('inserted'));
    const edited = registry.reconcile(planRenderIslands([group]));

    expect(edited.islands[0].resourceId).toBe(initial.islands[0].resourceId);
    expect(edited.releasedResourceIds).toEqual([]);
  });

  it('releases every retained identity on clear', () => {
    const registry = new RetainedRenderIslandRegistry();
    const retained = registry.reconcile(planRenderIslands([vector('one')])).islands[0];
    expect(registry.clear()).toEqual([retained.resourceId]);
    expect(registry.clear()).toEqual([]);
  });
});
