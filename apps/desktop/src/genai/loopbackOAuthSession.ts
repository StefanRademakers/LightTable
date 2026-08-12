import { createServer, type Server } from 'node:http';
import type { OpenArtAuthorizationSession } from '@lighttable/genai-openart';

const CALLBACK_PATH = '/oauth/openart/callback';
const DEFAULT_TIMEOUT_MS = 120_000;

const closeServer = (server: Server): Promise<void> => new Promise((resolve) => {
  if (!server.listening) {
    resolve();
    return;
  }
  server.close(() => resolve());
});

export const createLoopbackOAuthSession = async (
  expectedState: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<OpenArtAuthorizationSession> => {
  let resolveCallback!: (value: URLSearchParams) => void;
  let rejectCallback!: (reason: Error) => void;
  let settled = false;
  const callback = new Promise<URLSearchParams>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  // A transport can occasionally finish without awaiting the browser callback.
  // Keep an explicit handler so cancelling that unused callback is never an
  // unhandled rejection; consumers awaiting `callback` still receive it.
  void callback.catch(() => undefined);

  const server = createServer((request, response) => {
    try {
      if (request.method !== 'GET' || !request.url || request.url.length > 8192) {
        response.writeHead(400).end('Invalid LightTable authorization callback.');
        return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH || url.searchParams.get('state') !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('LightTable could not validate this authorization callback.');
        if (!settled) {
          settled = true;
          rejectCallback(new Error('OpenArt authorization callback state mismatch.'));
        }
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>LightTable connected</title><p>You can return to LightTable.</p>');
      if (!settled) {
        settled = true;
        resolveCallback(url.searchParams);
      }
    } catch {
      response.writeHead(400).end('Invalid LightTable authorization callback.');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('LightTable could not open a local authorization callback.');
  }

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCallback(new Error('OpenArt authorization timed out. Please try again.'));
    }
    void closeServer(server);
  }, timeoutMs);
  timeout.unref();

  return {
    redirectUrl: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
    callback,
    async close() {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        rejectCallback(new Error('OpenArt authorization was restarted.'));
      }
      await closeServer(server);
    }
  };
};
