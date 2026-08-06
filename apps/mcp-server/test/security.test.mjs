import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRemoteUrl } from '../src/mcp.mjs';

test('remote image validation blocks cleartext, credentials, ports and private networks', async () => {
  await assert.rejects(validateRemoteUrl('http://example.com/image.png'), /public HTTPS/u);
  await assert.rejects(validateRemoteUrl('https://user:pass@example.com/image.png'), /public HTTPS/u);
  await assert.rejects(validateRemoteUrl('https://example.com:8443/image.png'), /public HTTPS/u);
  await assert.rejects(validateRemoteUrl('https://127.0.0.1/image.png'), /Private, loopback/u);
  await assert.rejects(validateRemoteUrl('https://192.168.1.2/image.png'), /Private, loopback/u);
});
