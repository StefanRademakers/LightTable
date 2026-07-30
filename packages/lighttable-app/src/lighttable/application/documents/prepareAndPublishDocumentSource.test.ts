import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultGroupVisibility } from '../adjustments/groupVisibility';
import { createDefaultAdjustments } from '../../types';
import { prepareDocumentSource } from './prepareDocumentSource';
import { publishPreparedDocument } from './publishPreparedDocument';
import { prepareAndPublishDocumentSource } from './prepareAndPublishDocumentSource';

vi.mock('./prepareDocumentSource', () => ({
  prepareDocumentSource: vi.fn()
}));
vi.mock('./publishPreparedDocument', () => ({
  publishPreparedDocument: vi.fn()
}));

const prepare = vi.mocked(prepareDocumentSource);
const publish = vi.mocked(publishPreparedDocument);

const createRequest = (isCanceled: () => boolean = () => false) => ({
  renderer: {} as never,
  blob: new Blob(['image']),
  name: 'source.psd',
  cacheKey: 'cache-key',
  sourceIdentity: 'source-identity',
  decodeMode: 'fast' as const,
  initialAdjustments: createDefaultAdjustments(),
  groupVisibility: createDefaultGroupVisibility(),
  isCanceled,
  publication: {} as never
});

describe('prepareAndPublishDocumentSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a completely prepared document with its source identity', async () => {
    const prepared = { loaded: {}, hydration: {} } as never;
    prepare.mockResolvedValue(prepared);
    const request = createRequest();

    await expect(prepareAndPublishDocumentSource(request)).resolves.toBe(true);

    expect(publish).toHaveBeenCalledWith(prepared, {
      name: 'source.psd',
      identity: 'source-identity'
    }, request.publication);
  });

  it('does not publish a generation canceled during preparation', async () => {
    const prepared = { loaded: {}, hydration: {} } as never;
    prepare.mockResolvedValue(prepared);
    let canceled = false;
    prepare.mockImplementationOnce(async () => {
      canceled = true;
      return prepared;
    });

    await expect(prepareAndPublishDocumentSource(
      createRequest(() => canceled)
    )).resolves.toBe(false);

    expect(publish).not.toHaveBeenCalled();
  });
});
