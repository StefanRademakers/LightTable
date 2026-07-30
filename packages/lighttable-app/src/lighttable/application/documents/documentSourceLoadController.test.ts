import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentSourceLoadController,
  type DocumentSourceLoadControllerPort
} from './documentSourceLoadController';
import { createDefaultAdjustments } from '../../types';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';

const createRequest = () => ({
  blob: new Blob(['fixture'], { type: 'image/png' }),
  name: 'fixture.png',
  cacheKey: 'fixture-cache',
  sourceIdentity: 'fixture-source',
  decodeMode: 'fast' as const,
  initialAdjustments: createDefaultAdjustments()
});

describe('createDocumentSourceLoadController', () => {
  it('does not begin source work without a renderer', async () => {
    const getPublicationPorts = vi.fn();
    const port = {
      getRenderer: () => null,
      getGroupVisibility: createDefaultGroupVisibility,
      getPublicationPorts
    } satisfies DocumentSourceLoadControllerPort;

    await expect(
      createDocumentSourceLoadController(port).load(createRequest())
    ).resolves.toBe(false);
    expect(getPublicationPorts).not.toHaveBeenCalled();
  });

  it('does not begin source work for an already canceled generation', async () => {
    const getPublicationPorts = vi.fn();
    const port = {
      getRenderer: () => ({}) as ReturnType<
        DocumentSourceLoadControllerPort['getRenderer']
      >,
      getGroupVisibility: createDefaultGroupVisibility,
      getPublicationPorts
    } satisfies DocumentSourceLoadControllerPort;

    await expect(
      createDocumentSourceLoadController(port).load({
        ...createRequest(),
        isCanceled: () => true
      })
    ).resolves.toBe(false);
    expect(getPublicationPorts).not.toHaveBeenCalled();
  });
});
