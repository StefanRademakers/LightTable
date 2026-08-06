import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { LightTableOAuthStore } from '../src/oauth.mjs';

const challenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const createStore = () => new LightTableOAuthStore({ issuer: 'http://127.0.0.1:8787/',
  resource: 'http://127.0.0.1:8787/mcp', pairingCode: 'pair-12345678' });

test('OAuth authorization code flow enforces pairing, PKCE and requested scopes', async () => {
  const store = createStore();
  const client = store.register({ client_name: 'Test client', redirect_uris: ['http://127.0.0.1/callback'] });
  const verifier = 'a'.repeat(64);
  assert.throws(() => store.authorize({ clientId: client.client_id,
    redirectUri: client.redirect_uris[0], responseType: 'code', scope: 'lighttable:read',
    codeChallenge: challenge(verifier), codeChallengeMethod: 'S256', pairingCode: 'wrong-code' }),
  /pairing code is invalid/u);
  const code = store.authorize({ clientId: client.client_id, redirectUri: client.redirect_uris[0],
    responseType: 'code', scope: 'lighttable:read lighttable:edit offline_access',
    codeChallenge: challenge(verifier), codeChallengeMethod: 'S256', pairingCode: 'pair-12345678' });
  const tokens = store.exchangeCode({ code, clientId: client.client_id,
    redirectUri: client.redirect_uris[0], codeVerifier: verifier });
  assert.ok(tokens.refresh_token);
  const auth = await store.verifyAccessToken(tokens.access_token);
  assert.deepEqual(auth.scopes, ['lighttable:read', 'lighttable:edit', 'offline_access']);
  assert.throws(() => store.exchangeCode({ code, clientId: client.client_id,
    redirectUri: client.redirect_uris[0], codeVerifier: verifier }), /authorization code/u);
});

test('refresh tokens rotate and cannot be replayed', () => {
  const store = createStore();
  const client = store.register({ redirect_uris: ['http://127.0.0.1/callback'] });
  const issued = store.issue(client.client_id, ['lighttable:read', 'offline_access'], true);
  const refreshed = store.exchangeRefresh({ refreshToken: issued.refresh_token, clientId: client.client_id });
  assert.ok(refreshed.access_token);
  assert.notEqual(refreshed.refresh_token, issued.refresh_token);
  assert.throws(() => store.exchangeRefresh({ refreshToken: issued.refresh_token,
    clientId: client.client_id }), /refresh token is invalid/u);
});

test('dynamic registration rejects unsafe redirect URIs', () => {
  const store = createStore();
  assert.throws(() => store.register({ redirect_uris: ['http://public.example/callback'] }), /HTTPS/u);
  assert.throws(() => store.register({ redirect_uris: ['javascript:alert(1)'] }), /HTTPS/u);
  assert.doesNotThrow(() => store.register({ redirect_uris: ['http://127.0.0.1:4399/callback'] }));
});
