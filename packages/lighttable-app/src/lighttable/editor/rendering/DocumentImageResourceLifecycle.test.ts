import { describe, expect, it, vi } from 'vitest';
import { DocumentImageResourceLifecycle } from './DocumentImageResourceLifecycle';
import { DocumentResourceState } from './DocumentResourceState';

describe('DocumentImageResourceLifecycle', () => {
  it('invalidates pending work before replacing resources and dimensions', () => {
    const resourceState = new DocumentResourceState();
    resourceState.setDimensions(640, 480);
    const generation = resourceState.generation();
    const observations: string[] = [];
    const lifecycle = new DocumentImageResourceLifecycle({
      resourceState,
      teardown: [
        () => {
          observations.push(
            `${resourceState.isCurrent(generation)}:${resourceState.dimensions().width}`
          );
        }
      ]
    });

    lifecycle.begin(1920, 1080);

    expect(observations).toEqual(['false:640']);
    expect(resourceState.dimensions()).toEqual({ width: 1920, height: 1080 });
  });

  it('runs every registered teardown action in stable order', () => {
    const resourceState = new DocumentResourceState();
    const first = vi.fn();
    const second = vi.fn();
    const lifecycle = new DocumentImageResourceLifecycle({
      resourceState,
      teardown: [first, second]
    });

    lifecycle.destroy();

    expect(first.mock.invocationCallOrder[0]).toBeLessThan(
      second.mock.invocationCallOrder[0]
    );
    expect(resourceState.generation()).toBe(1);
  });
});
