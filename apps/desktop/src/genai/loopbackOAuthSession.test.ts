import { describe, expect, it } from 'vitest';
import { createLoopbackOAuthSession } from './loopbackOAuthSession';

describe('createLoopbackOAuthSession', () => {
  it('accepts a callback only when the OAuth state matches', async () => {
    const session = await createLoopbackOAuthSession('expected', 2_000);
    const response = await fetch(`${session.redirectUrl}?code=abc&state=expected`);
    expect(response.status).toBe(200);
    expect((await session.callback).get('code')).toBe('abc');
    await session.close();
  });

  it('rejects a mismatched callback state', async () => {
    const session = await createLoopbackOAuthSession('expected', 2_000);
    const callback = session.callback.catch((reason: Error) => reason.message);
    const response = await fetch(`${session.redirectUrl}?code=abc&state=wrong`);
    expect(response.status).toBe(400);
    await expect(callback).resolves.toContain('state mismatch');
    await session.close();
  });

  it('times out without leaving the listener open', async () => {
    const session = await createLoopbackOAuthSession('expected', 10);
    await expect(session.callback).rejects.toThrow('timed out');
    await session.close();
  });
});
