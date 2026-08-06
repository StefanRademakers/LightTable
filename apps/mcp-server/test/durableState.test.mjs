import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EncryptedJsonFileStore } from '../src/durableState.mjs';
import { LightTableOAuthStore } from '../src/oauth.mjs';

const challenge = (value) => createHash('sha256').update(value).digest('base64url');

test('encrypted OAuth state survives restart without storing tokens or metadata in clear text', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'lighttable-oauth-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'oauth.state'); const secret = 's'.repeat(64);
  const options = { issuer: 'https://agent.example/', resource: 'https://agent.example/mcp',
    pairingCode: 'pairing-12345678', stateStore: new EncryptedJsonFileStore({ path, secret }),
    tenantId: 'tenant-a', userId: 'user-a' };
  const first = new LightTableOAuthStore(options);
  const client = first.register({ client_name: 'Private design client', redirect_uris: ['https://client.example/callback'] });
  const verifier = 'v'.repeat(64);
  const code = first.authorize({ clientId: client.client_id, redirectUri: client.redirect_uris[0],
    responseType: 'code', scope: 'lighttable:read offline_access', codeChallenge: challenge(verifier),
    codeChallengeMethod: 'S256', pairingCode: 'pairing-12345678' });
  const token = first.exchangeCode({ code, clientId: client.client_id,
    redirectUri: client.redirect_uris[0], codeVerifier: verifier });
  const disk = readFileSync(path, 'utf8');
  assert.doesNotMatch(disk, /Private design client|tenant-a|access_token|lighttable:read/u);

  const restarted = new LightTableOAuthStore({ ...options,
    stateStore: new EncryptedJsonFileStore({ path, secret }) });
  const auth = await restarted.verifyAccessToken(token.access_token);
  assert.deepEqual({ tenantId: auth.tenantId, userId: auth.userId, scopes: auth.scopes }, {
    tenantId: 'tenant-a', userId: 'user-a', scopes: ['lighttable:read', 'offline_access']
  });
  const refreshed = restarted.exchangeRefresh({ refreshToken: token.refresh_token, clientId: client.client_id });
  assert.ok(refreshed.access_token);
});

test('durable state rejects a mismatched encryption key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lighttable-state-key-'));
  try {
    const path = join(directory, 'state');
    new EncryptedJsonFileStore({ path, secret: 'a'.repeat(64) }).save({ secret: true });
    assert.throws(() => new EncryptedJsonFileStore({ path, secret: 'b'.repeat(64) }).load());
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
